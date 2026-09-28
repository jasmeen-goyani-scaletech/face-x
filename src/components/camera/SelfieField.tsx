'use client';

import { useState } from 'react';
import CameraCaptureModal from './CameraCaptureModal';
import Button from '@/components/ui/Button';
import { CameraIcon, CheckIcon } from '@/components/ui/Icons';

export default function SelfieField({
  dataUrl,
  onCapture,
  heading,
  label = 'Selfie Photo'
}: {
  dataUrl: string;
  onCapture: (dataUrl: string) => void;
  heading?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="text-center">
      <div
        className={[
          'relative mx-auto mb-4 h-40 w-40 rounded-full flex items-center justify-center overflow-hidden',
          dataUrl ? 'border-[3px] border-accent' : 'border-2 border-dashed border-line-strong bg-surface-2'
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
      <Button variant="primary" onClick={() => setOpen(true)}>
        <CameraIcon size={16} /> {dataUrl ? 'Retake Photo' : 'Take Photo'}
      </Button>
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
