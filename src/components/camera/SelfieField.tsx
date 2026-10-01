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
  id
}: {
  dataUrl: string;
  onCapture: (dataUrl: string) => void;
  heading?: string;
  label?: string;
  /** Specific fix message shown under the button, e.g. when the photo is still required. */
  error?: string | null;
  /** Id of the capture button, so a failed submit can scroll to and focus it. */
  id?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="text-center">
      <div
        className={[
          'relative mx-auto mb-4 h-40 w-40 rounded-full flex items-center justify-center overflow-hidden',
          dataUrl ? 'border-[3px] border-primary' : 'border-2 border-dashed border-line-strong bg-surface-2'
        ].join(' ')}
      >
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dataUrl} alt={label} className="h-full w-full object-cover" />
        ) : (
          <CameraIcon size={36} className="text-ink-faint" />
        )}
        {dataUrl && (
          <span className="absolute bottom-1.5 right-1.5 h-6 w-6 rounded-full bg-success text-white flex items-center justify-center">
            <CheckIcon size={14} />
          </span>
        )}
      </div>
      <Button id={id} variant="primary" onClick={() => setOpen(true)}>
        <CameraIcon size={16} /> {dataUrl ? 'Retake Photo' : 'Take Photo'}
      </Button>
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
