'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import { AlertTriangleIcon, CameraIcon, CheckIcon, ChevronLeftIcon, RefreshIcon } from '@/components/ui/Icons';
import { FaceGuidanceBanner, FaceReadyFrame } from './FaceGuide';
import { useFaceGuidance } from './useFaceGuidance';

type Status = 'requesting' | 'live' | 'captured' | 'error';
type FacingMode = 'user' | 'environment';

interface ErrorInfo {
  title: string;
  message: string;
}

function cameraErrorInfo(err: unknown): ErrorInfo {
  const name = err instanceof DOMException ? err.name : (err as { name?: string } | undefined)?.name || '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return {
        title: 'Camera access denied',
        message: "Camera access is required to take your selfie. Allow camera access for this page in your browser's site settings, then try again."
      };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return { title: 'No camera found', message: 'We couldn’t find a camera on this device. A camera is required to take your selfie.' };
    case 'NotReadableError':
    case 'TrackStartError':
      return { title: 'Camera unavailable', message: 'Your camera may already be in use by another app. Close it and try again.' };
    case 'NotSupportedError':
      return { title: 'Camera not supported', message: 'Live camera isn’t available in this browser. Try a different browser or device.' };
    case 'TimeoutError':
      return { title: 'Camera took too long to respond', message: 'We couldn’t connect to your camera in time. Try again.' };
    case 'AbortError':
      return { title: 'Camera interrupted', message: 'Camera access was interrupted before it could start. Try again.' };
    default:
      return { title: 'Camera error', message: 'Something went wrong accessing your camera. Try again.' };
  }
}

function requestCameraStream(constraints: MediaStreamConstraints): Promise<MediaStream> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const err = new DOMException('Camera API not supported', 'NotSupportedError');
    return Promise.reject(err);
  }
  const timeout = new Promise<MediaStream>((_, reject) => {
    setTimeout(() => reject(new DOMException('Camera request timed out', 'TimeoutError')), 8000);
  });
  return Promise.race([navigator.mediaDevices.getUserMedia(constraints), timeout]);
}

export default function CameraCaptureModal({
  open,
  heading = 'Face Scan',
  review = true,
  onClose,
  onCapture
}: {
  open: boolean;
  heading?: string;
  /** Show the captured photo with Retake / Use This Photo. Turn off for scanning, where the capture is used straight away. */
  review?: boolean;
  onClose: () => void;
  onCapture: (dataUrl: string) => void;
}) {
  const [status, setStatus] = useState<Status>('requesting');
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [capturedDataUrl, setCapturedDataUrl] = useState('');
  const [facingMode, setFacingMode] = useState<FacingMode>('user');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestIdRef = useRef(0);
  const frameRef = useRef<HTMLDivElement>(null);
  const [nudge, setNudge] = useState(false);

  // Live face-positioning guidance: says what to fix, and unlocks the shutter once the face is ready.
  const face = useFaceGuidance({ active: open && status === 'live', videoRef, frameRef });
  const ready = face.detector === 'ready' && face.guidance?.code === 'good';

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startLiveCamera = useCallback(
    (mode: FacingMode = facingMode) => {
      stopStream();
      setStatus('requesting');
      const myRequestId = ++requestIdRef.current;

      // Ask for HD: the saved photo is a screen-shaped crop of this stream, so a low-res default loses detail.
      requestCameraStream({ video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'OverconstrainedError') {
            return requestCameraStream({ video: true, audio: false });
          }
          throw err;
        })
        .then((stream) => {
          if (myRequestId !== requestIdRef.current) {
            stream.getTracks().forEach((t) => t.stop()); // superseded by a retry/retake or close
            return;
          }
          streamRef.current = stream;
          setStatus('live');
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(() => {});
          }
        })
        .catch((err) => {
          if (myRequestId !== requestIdRef.current) return;
          setError(cameraErrorInfo(err));
          setStatus('error');
        });
    },
    [stopStream, facingMode]
  );

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    setCapturedDataUrl('');
    setFacingMode('user');
    startLiveCamera('user');
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mutating the live ref, not reading a stale snapshot
      requestIdRef.current++; // invalidate any in-flight request so a late resolve can't leave the camera running
      stopStream();
      document.body.style.overflow = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Re-attach the stream if the <video> element remounts while already live (status transitions).
  useEffect(() => {
    if (status === 'live' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [status]);

  function flipCamera() {
    const next = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(next);
    startLiveCamera(next);
  }

  function captureFrame() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    if (!face.canCapture) {
      // Guidance says the face isn't ready — flash the instruction instead of taking a poor photo.
      setNudge(true);
      setTimeout(() => setNudge(false), 1200);
      return;
    }
    // Save exactly what the user sees: the on-screen frame is a cover-crop of the video.
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
    if (!ctx) return;
    if (facingMode === 'user') {
      ctx.translate(outW, 0);
      ctx.scale(-1, 1); // mirror to match the live preview, front camera only
    }
    ctx.drawImage(video, sx, sy, srcW, srcH, 0, 0, outW, outH);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    stopStream();
    if (!review) {
      requestIdRef.current++;
      onCapture(dataUrl);
      return;
    }
    setCapturedDataUrl(dataUrl);
    setStatus('captured');
  }

  function handleClose() {
    requestIdRef.current++;
    stopStream();
    onClose();
  }

  function handleConfirm() {
    const dataUrl = capturedDataUrl;
    requestIdRef.current++;
    stopStream();
    onCapture(dataUrl);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black text-white">
      {/* The camera frame is the entire screen; everything else floats on top of it. */}
      <div ref={frameRef} className="absolute inset-0 overflow-hidden">
        {status === 'requesting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="h-8 w-8 rounded-full border-[3px] border-primary border-t-transparent animate-spin" />
            <p className="mt-4 text-sm text-white/70">Requesting camera access…</p>
          </div>
        )}

        {status === 'live' && (
          <>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={['absolute inset-0 h-full w-full object-cover', facingMode === 'user' ? '-scale-x-100' : ''].join(' ')}
            />
            <FaceReadyFrame ready={ready} />
          </>
        )}

        {status === 'captured' && (
          // Data-URL preview of the just-captured frame; same aspect as the live view.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={capturedDataUrl} alt="Captured selfie" className="absolute inset-0 h-full w-full object-cover" />
        )}

        {status === 'error' && error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
            <AlertTriangleIcon size={36} className="text-danger mb-3" />
            <h3 className="text-lg font-bold mb-1.5">{error.title}</h3>
            <p className="text-sm text-white/70 mb-6 max-w-[320px]">{error.message}</p>
            <Button variant="primary" onClick={() => startLiveCamera()}>
              <RefreshIcon size={16} /> Try Again
            </Button>
          </div>
        )}
      </div>

      {/* Top overlay: close / title / switch camera, then the live instruction. */}
      <div
        className="absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/70 to-transparent px-4 pb-6"
        style={{ paddingTop: 'calc(12px + env(safe-area-inset-top, 0px))' }}
      >
        <div className="flex items-center justify-between">
          <button aria-label="Close scanner" onClick={handleClose} className="flex h-11 min-w-[70px] items-center gap-1.5 text-white text-sm font-semibold">
            <ChevronLeftIcon size={18} /> Close
          </button>
          <span className="font-display font-bold uppercase tracking-wide text-[13px] text-white">{heading}</span>
          {status === 'live' ? (
            <button aria-label="Switch camera" onClick={flipCamera} className="flex h-11 w-[70px] items-center justify-end text-white">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm">
                <RefreshIcon size={20} />
              </span>
            </button>
          ) : (
            <span className="w-[70px]" aria-hidden />
          )}
        </div>
        {status === 'live' && <FaceGuidanceBanner detector={face.detector} guidance={face.guidance} pulse={nudge} className="mt-3" />}
      </div>

      {/* Bottom overlay: shutter, or retake / confirm. */}
      {status === 'live' && (
        <div
          className="absolute inset-x-0 bottom-0 z-10 flex justify-center bg-gradient-to-t from-black/70 to-transparent pt-10"
          style={{ paddingBottom: 'calc(28px + env(safe-area-inset-bottom, 0px))' }}
        >
          <button
            aria-label="Capture photo"
            aria-disabled={!face.canCapture}
            onClick={captureFrame}
            className={[
              'flex h-[72px] w-[72px] items-center justify-center rounded-full shadow-2xl active:scale-95 transition',
              ready ? 'bg-[#22c55e] text-[#06130d] ring-4 ring-[#22c55e]/40' : 'bg-primary text-primary-foreground',
              face.canCapture ? '' : 'opacity-40'
            ].join(' ')}
          >
            <span className="flex h-[54px] w-[54px] items-center justify-center rounded-full border-2 border-white/40">
              <CameraIcon size={26} />
            </span>
          </button>
        </div>
      )}

      {status === 'captured' && (
        <div
          className="absolute inset-x-0 bottom-0 z-10 flex gap-2.5 bg-gradient-to-t from-black/80 to-transparent px-5 pt-12"
          style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))' }}
        >
          <Button variant="secondary" className="flex-1" onClick={() => startLiveCamera()}>
            <RefreshIcon size={16} /> Retake
          </Button>
          <Button variant="primary" className="flex-1" onClick={handleConfirm}>
            <CheckIcon size={16} /> Use This Photo
          </Button>
        </div>
      )}
    </div>
  );
}
