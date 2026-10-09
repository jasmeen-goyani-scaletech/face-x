'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraStatus = 'requesting' | 'live' | 'error';
type Facing = 'user' | 'environment';

export interface CameraErrorInfo {
  title: string;
  message: string;
}

function cameraErrorInfo(err: unknown): CameraErrorInfo {
  const name = err instanceof DOMException ? err.name : (err as { name?: string } | undefined)?.name || '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return { title: 'Camera access denied', message: 'Allow camera access for this page in your browser’s site settings, then try again.' };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return { title: 'No camera found', message: 'This device has no camera the scanner can use.' };
    case 'NotReadableError':
    case 'TrackStartError':
      return { title: 'Camera unavailable', message: 'Another app may be using the camera. Close it and try again.' };
    case 'NotSupportedError':
      return { title: 'Camera not supported', message: 'Live camera isn’t available in this browser. Try a different browser or device.' };
    case 'TimeoutError':
      return { title: 'Camera took too long to respond', message: 'The camera didn’t start in time. Try again.' };
    default:
      return { title: 'Camera error', message: 'Something went wrong starting the camera. Try again.' };
  }
}

function requestStream(constraints: MediaStreamConstraints): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(new DOMException('Camera API not supported', 'NotSupportedError'));
  const timeout = new Promise<MediaStream>((_, reject) => setTimeout(() => reject(new DOMException('Camera request timed out', 'TimeoutError')), 8000));
  return Promise.race([navigator.mediaDevices.getUserMedia(constraints), timeout]);
}

/**
 * An always-on camera for the scanner: starts as soon as the component mounts (no "Start camera" tap), stops on unmount,
 * and can flip between front and rear. Defaults to the rear camera (staff point it at the person), falling back to any
 * camera. `capture()` saves exactly what the on-screen frame shows.
 */
export function useScannerCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestId = useRef(0);
  const [status, setStatus] = useState<CameraStatus>('requesting');
  const [error, setError] = useState<CameraErrorInfo | null>(null);
  const [facing, setFacing] = useState<Facing>('environment');
  const [mirrored, setMirrored] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(
    (mode: Facing) => {
      stop();
      setStatus('requesting');
      setError(null);
      const mine = ++requestId.current;
      requestStream({ video: { facingMode: { ideal: mode }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'OverconstrainedError') return requestStream({ video: true, audio: false });
          throw err;
        })
        .then((stream) => {
          if (mine !== requestId.current) {
            stream.getTracks().forEach((t) => t.stop()); // superseded by a retry, a flip, or unmount
            return;
          }
          streamRef.current = stream;
          // A laptop webcam reports "user" even when we asked for the rear camera; mirror whatever is actually front-facing.
          const reported = stream.getVideoTracks()[0]?.getSettings().facingMode;
          setMirrored(reported ? reported === 'user' : mode === 'user');
          setStatus('live');
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(() => {});
          }
        })
        .catch((err) => {
          if (mine !== requestId.current) return;
          setError(cameraErrorInfo(err));
          setStatus('error');
        });
    },
    [stop]
  );

  useEffect(() => {
    start('environment');
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally bumping the live counter so a late camera grant can't leave the stream running
      requestId.current++;
      stop();
    };
  }, [start, stop]);

  // Re-attach if the <video> remounts while already live.
  useEffect(() => {
    if (status === 'live' && videoRef.current && streamRef.current && videoRef.current.srcObject !== streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [status]);

  const flip = useCallback(() => {
    const next: Facing = facing === 'user' ? 'environment' : 'user';
    setFacing(next);
    start(next);
  }, [facing, start]);

  const retry = useCallback(() => start(facing), [facing, start]);

  /** A JPEG of the visible frame (a cover-crop of the video, as shown), or null if there is no picture yet. */
  const capture = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const frameW = frameRef.current?.clientWidth || video.videoWidth;
    const frameH = frameRef.current?.clientHeight || video.videoHeight;
    const scale = Math.max(frameW / video.videoWidth, frameH / video.videoHeight);
    const srcW = frameW / scale;
    const srcH = frameH / scale;
    const sx = (video.videoWidth - srcW) / 2;
    const sy = (video.videoHeight - srcH) / 2;
    const outW = Math.min(720, Math.round(srcW));
    const outH = Math.round((outW * frameH) / frameW);
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    if (mirrored) {
      ctx.translate(outW, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, sx, sy, srcW, srcH, 0, 0, outW, outH);
    return canvas.toDataURL('image/jpeg', 0.85);
  }, [mirrored]);

  return { videoRef, frameRef, status, error, mirrored, flip, retry, capture };
}
