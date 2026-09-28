'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import { CameraIcon, CheckIcon, RefreshIcon, XIcon } from '@/components/ui/Icons';

type Status = 'requesting' | 'live' | 'captured' | 'error';

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
  heading = 'Position your face in the frame',
  onClose,
  onCapture
}: {
  open: boolean;
  heading?: string;
  onClose: () => void;
  onCapture: (dataUrl: string) => void;
}) {
  const [status, setStatus] = useState<Status>('requesting');
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [capturedDataUrl, setCapturedDataUrl] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestIdRef = useRef(0);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startLiveCamera = useCallback(() => {
    stopStream();
    setStatus('requesting');
    const myRequestId = ++requestIdRef.current;

    requestCameraStream({ video: { facingMode: 'user' }, audio: false })
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
  }, [stopStream]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    setCapturedDataUrl('');
    startLiveCamera();
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

  function captureFrame() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const size = Math.min(video.videoWidth, video.videoHeight);
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const sx = (video.videoWidth - size) / 2;
    const sy = (video.videoHeight - size) / 2;
    ctx.translate(480, 0);
    ctx.scale(-1, 1); // mirror to match the live preview
    ctx.drawImage(video, sx, sy, size, size, 0, 0, 480, 480);
    setCapturedDataUrl(canvas.toDataURL('image/jpeg', 0.9));
    stopStream();
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      style={{ paddingTop: 'calc(16px + env(safe-area-inset-top, 0px))', paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="w-full max-w-[420px] max-h-full overflow-y-auto rounded-l bg-surface shadow-2xl momentum-scroll">
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-line">
          <h3 className="text-[14.5px] tracking-wide m-0">
            {status === 'error' ? error?.title : status === 'captured' ? 'Use this photo?' : status === 'requesting' ? 'Camera' : heading}
          </h3>
          <button
            aria-label="Close"
            onClick={handleClose}
            className="touch-target flex items-center justify-center rounded-full bg-surface-2 text-ink-soft"
          >
            <XIcon size={18} />
          </button>
        </div>

        {status === 'requesting' && (
          <div className="flex flex-col items-center px-5 py-10 text-center">
            <span className="h-7 w-7 rounded-full border-[3px] border-accent border-t-transparent animate-spin" />
            <p className="mt-3.5 text-sm text-ink-soft">Requesting camera access…</p>
          </div>
        )}

        {status === 'live' && (
          <>
            <div className="flex flex-col items-center px-5 py-5">
              <div className="relative h-60 w-60 rounded-full overflow-hidden bg-black">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover -scale-x-100" />
                <div className="absolute inset-1.5 rounded-full border-2 border-dashed border-white/55 pointer-events-none" />
              </div>
            </div>
            <div className="flex gap-2.5 px-5 py-4 border-t border-line">
              <Button variant="secondary" className="flex-1" onClick={handleClose}>
                Cancel
              </Button>
              <Button variant="primary" className="flex-1" onClick={captureFrame}>
                <CameraIcon size={18} /> Capture
              </Button>
            </div>
          </>
        )}

        {status === 'captured' && (
          <>
            <div className="flex flex-col items-center px-5 py-5">
              {/* Data-URL preview of the just-captured frame, not a remote image. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={capturedDataUrl}
                alt="Captured selfie"
                className="h-60 w-60 rounded-full object-cover border-[3px] border-accent"
              />
            </div>
            <div className="flex gap-2.5 px-5 py-4 border-t border-line">
              <Button variant="secondary" className="flex-1" onClick={startLiveCamera}>
                <RefreshIcon size={16} /> Retake
              </Button>
              <Button variant="primary" className="flex-1" onClick={handleConfirm}>
                <CheckIcon size={16} /> Use This Photo
              </Button>
            </div>
          </>
        )}

        {status === 'error' && error && (
          <>
            <div className="px-5 py-5">
              <Alert level="danger" title={error.title}>
                {error.message}
              </Alert>
            </div>
            <div className="px-5 py-4 border-t border-line">
              <Button variant="primary" block onClick={startLiveCamera}>
                <RefreshIcon size={16} /> Try Again
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
