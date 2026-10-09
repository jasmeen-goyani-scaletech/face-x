'use client';

import { useState } from 'react';
import CameraCaptureModal from './CameraCaptureModal';
import Button from '@/components/ui/Button';
import { CameraIcon, CheckIcon } from '@/components/ui/Icons';
import { FieldError } from '@/components/ui/FormFieldWrapper';

export default function SelfieField({
  dataUrl,
  onCapture,
  heading,
  label = 'Selfie Photo',
  error,
  id,
  stored,
  busy,
  locked
}: {
  dataUrl: string;
  onCapture: (dataUrl: string) => void;
  heading?: string;
  label?: string;
  /** Specific fix message shown under the button, e.g. when the photo is still required. */
  error?: string | null;
  /** Id of the capture button, so a failed submit can scroll to and focus it. */
  id?: string;
  /** A photo is already stored (e.g. from an earlier visit) even though there is no preview to show. */
  stored?: boolean;
  /** The photo is being sent: the button is disabled and says so. */
  busy?: boolean;
  /** The photo is in review or approved: it can't be retaken, so the button is replaced by a short note. */
  locked?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="text-center">
      <div
        className={[
          'relative mx-auto mb-4 h-40 w-40 rounded-full flex items-center justify-center overflow-hidden',
          dataUrl || stored ? 'border-[3px] border-primary' : 'border-2 border-dashed border-line-strong bg-surface-2'
        ].join(' ')}
      >
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dataUrl} alt={label} className="h-full w-full object-cover" />
        ) : (
          <CameraIcon size={36} className="text-ink-faint" />
        )}
        {(dataUrl || stored) && (
          <span className="absolute bottom-1.5 right-1.5 h-6 w-6 rounded-full bg-success text-white flex items-center justify-center">
            <CheckIcon size={14} />
          </span>
        )}
      </div>
      {locked ? (
        <p className="m-0 text-[13px] text-ink-soft">This photo is with staff or already approved, so it can’t be changed.</p>
      ) : (
        <Button id={id} variant="primary" loading={busy} onClick={() => setOpen(true)}>
          {!busy && <CameraIcon size={16} />} {busy ? 'Uploading…' : dataUrl || stored ? 'Retake Photo' : 'Take Photo'}
        </Button>
      )}
      {error && (
        <FieldError className="mt-2">{error}</FieldError>
      )}
      <CameraCaptureModal
        open={open}
        heading={heading}
        onClose={() => setOpen(false)}
        onCapture={(url) => {
          onCapture(url);
          setOpen(false);
        }}
      />
    </div>
  );
}
