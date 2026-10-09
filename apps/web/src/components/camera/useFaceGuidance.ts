'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { FaceDetector } from '@mediapipe/tasks-vision';
import {
  createGuidanceSmoother,
  evaluateFaces,
  measureLighting,
  type FaceObservation,
  type Guidance,
  type LightingStats,
  type Point
} from '@/lib/faceGuidance';

/** `ready`: guidance is live. `unavailable`: detector couldn't load — the camera still works, unguided. */
export type DetectorState = 'loading' | 'ready' | 'unavailable';

const SAMPLE_INTERVAL_MS = 150;
const MAX_CONSECUTIVE_ERRORS = 8;
const LOAD_TIMEOUT_MS = 10000;
const LIGHT_SAMPLE_W = 64; // brightness is read from a tiny greyscale copy of the frame — cheap enough for every tick

// One detector for the whole app session — loading the wasm + model is the expensive part.
let detectorPromise: Promise<FaceDetector> | null = null;

function loadDetector(): Promise<FaceDetector> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
      // Both the wasm runtime and the model are served from our own origin (see scripts/copy-mediapipe.mjs
      // and public/models) so scanning works offline at the field.
      const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
      return FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: '/models/blaze_face_short_range.tflite', delegate: 'CPU' },
        runningMode: 'VIDEO',
        minDetectionConfidence: 0.5
      });
    })().catch((err) => {
      detectorPromise = null; // allow a retry next time the camera opens
      throw err;
    });
  }
  return detectorPromise;
}

function toObservations(detector: FaceDetector, video: HTMLVideoElement): FaceObservation[] {
  const { detections } = detector.detectForVideo(video, performance.now());
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const observations: FaceObservation[] = [];
  for (const d of detections) {
    const b = d.boundingBox;
    if (!b) continue;
    // BlazeFace keypoints (normalised 0–1): 0 right eye, 1 left eye, 2 nose tip, 3 mouth, 4/5 ears.
    const kp = (i: number): Point | undefined => (d.keypoints[i] ? { x: d.keypoints[i].x * vw, y: d.keypoints[i].y * vh } : undefined);
    observations.push({
      box: { x: b.originX, y: b.originY, w: b.width, h: b.height },
      rightEye: kp(0),
      leftEye: kp(1),
      nose: kp(2)
    });
  }
  return observations;
}

/** Downscales the current video frame to greyscale luma. Null if the canvas can't be read. */
function sampleLuma(video: HTMLVideoElement, canvas: HTMLCanvasElement): { luma: Uint8Array; w: number; h: number } | null {
  const w = LIGHT_SAMPLE_W;
  const h = Math.max(1, Math.round((w * video.videoHeight) / video.videoWidth));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const luma = new Uint8Array(w * h);
  for (let i = 0; i < luma.length; i++) {
    luma[i] = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2];
  }
  return { luma, w, h };
}

export interface FaceGuidanceResult {
  detector: DetectorState;
  /** Debounced instruction to show, or null before the first sample. */
  guidance: Guidance | null;
  /** True once the face is well placed and steady, or when guidance is unavailable (never blocks the camera). */
  canCapture: boolean;
}

/**
 * Watches a live `<video>` and reports what the user should do to get a clear, well-framed capture.
 * `frameRef` is the element whose box is the visible camera frame (the video fills it, object-cover).
 */
export function useFaceGuidance({
  active,
  videoRef,
  frameRef
}: {
  active: boolean;
  videoRef: RefObject<HTMLVideoElement>;
  frameRef: RefObject<HTMLElement>;
}): FaceGuidanceResult {
  const [detectorState, setDetectorState] = useState<DetectorState>('loading');
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  const [steady, setSteady] = useState(false);

  useEffect(() => {
    if (!active) {
      setGuidance(null);
      setSteady(false);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const smoother = createGuidanceSmoother();
    let prevCenter: Point | null = null;
    let prevFaceBox: { x: number; y: number; w: number; h: number } | null = null;
    const lightCanvas = document.createElement('canvas');
    let errors = 0;

    setDetectorState('loading');
    setGuidance(null);
    setSteady(false);

    // Don't leave the shutter locked forever if the model is slow or never loads.
    const loadTimeout = setTimeout(() => {
      if (!cancelled) setDetectorState((s) => (s === 'loading' ? 'unavailable' : s));
    }, LOAD_TIMEOUT_MS);

    loadDetector()
      .then((detector) => {
        clearTimeout(loadTimeout);
        if (cancelled) return;
        setDetectorState('ready');
        timer = setInterval(() => {
          const video = videoRef.current;
          const frameEl = frameRef.current;
          if (!video || !frameEl || video.readyState < 2 || !video.videoWidth || !frameEl.clientWidth) return;
          try {
            const faces = toObservations(detector, video);
            // Brightness is measured where the face was on the previous sample — one tick of lag is
            // imperceptible, and it keeps the detector's box out of the sampling path.
            let light: LightingStats | null = null;
            if (prevFaceBox) {
              const sample = sampleLuma(video, lightCanvas);
              if (sample) {
                const k = sample.w / video.videoWidth;
                light = measureLighting(sample.luma, { w: sample.w, h: sample.h }, {
                  x: prevFaceBox.x * k,
                  y: prevFaceBox.y * k,
                  w: prevFaceBox.w * k,
                  h: prevFaceBox.h * k
                });
              }
            }
            const evaluation = evaluateFaces(
              faces,
              { w: video.videoWidth, h: video.videoHeight },
              { w: frameEl.clientWidth, h: frameEl.clientHeight },
              prevCenter,
              light
            );
            prevCenter = evaluation.center;
            prevFaceBox = evaluation.faceBox;
            const shown = smoother.push(evaluation.guidance);
            errors = 0;
            setGuidance((prev) => (prev && prev.code === shown.code ? prev : shown));
            setSteady(shown.code === 'good');
          } catch {
            if (++errors >= MAX_CONSECUTIVE_ERRORS) {
              if (timer) clearInterval(timer);
              setDetectorState('unavailable');
              setGuidance(null);
              setSteady(false);
            }
          }
        }, SAMPLE_INTERVAL_MS);
      })
      .catch(() => {
        clearTimeout(loadTimeout);
        if (!cancelled) setDetectorState('unavailable');
      });

    return () => {
      cancelled = true;
      clearTimeout(loadTimeout);
      if (timer) clearInterval(timer);
    };
  }, [active, videoRef, frameRef]);

  return {
    detector: detectorState,
    guidance,
    // Locked until the face is well placed and steady — including while guidance is still starting.
    // Only a detector that failed or timed out (`unavailable`) leaves the shutter free.
    canCapture: detectorState === 'unavailable' || steady
  };
}
