'use client';

import { useId, useState } from 'react';
import { reviewChip } from './Chip';
import { FileIcon, UploadIcon, XIcon } from './Icons';
import type { UploadedFile } from '@/lib/types';

export default function UploadField({
  label,
  value,
  onChange,
  accept = 'image/*,.pdf'
}: {
  label: string;
  value: UploadedFile;
  onChange: (next: UploadedFile) => void;
  accept?: string;
}) {
  const id = useId();
  const [zoom, setZoom] = useState(false);
  const isImage = !!value.dataUrl && value.dataUrl.startsWith('data:image');

  function handleFile(file: File) {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        onChange({ uploaded: true, fileName: file.name, dataUrl: String(reader.result), review: 'not_submitted', reason: '' });
      };
      reader.readAsDataURL(file);
    } else {
      onChange({ uploaded: true, fileName: file.name, review: 'not_submitted', reason: '' });
    }
  }

  return (
    <div className="flex items-center gap-3.5 py-3.5 border-b border-line last:border-b-0 flex-wrap">
      <div className="h-10 w-10 rounded-s bg-surface-2 flex items-center justify-center text-ink-soft shrink-0 overflow-hidden">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value.dataUrl}
            alt={label}
            className="h-full w-full object-cover cursor-zoom-in"
            onClick={() => setZoom(true)}
          />
        ) : value.uploaded ? (
          <FileIcon size={18} />
        ) : (
          <UploadIcon size={18} />
        )}
      </div>
      <div className="flex-1 min-w-[150px]">
        <div className="font-bold text-sm">
          {label} <span className="text-danger">*</span>
        </div>
        {value.review === 'rejected' ? (
          <div className="text-[12.5px] text-danger mt-0.5">{value.reason || 'Document was rejected. Please re-upload.'}</div>
        ) : (
          <div className="text-[12.5px] text-ink-faint">{value.uploaded ? value.fileName : 'No file uploaded yet'}</div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {reviewChip(value.uploaded ? (value.review === 'not_submitted' ? 'uploaded' : value.review) : 'missing')}
        {value.uploaded && (
          <button
            type="button"
            aria-label={`Remove ${label}`}
            onClick={() => onChange({ uploaded: false, fileName: '', review: 'not_submitted' })}
            className="touch-target flex items-center justify-center rounded-s border border-line-strong text-ink-soft"
          >
            <XIcon size={15} />
          </button>
        )}
        <label
          htmlFor={id}
          className="touch-target inline-flex items-center gap-1.5 rounded-s bg-accent text-accent-ink px-3 py-2 text-[13px] font-bold cursor-pointer"
        >
          <UploadIcon size={14} /> {value.uploaded ? 'Replace' : 'Upload'}
        </label>
        <input
          id={id}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = '';
          }}
        />
      </div>

      {zoom && isImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setZoom(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value.dataUrl} alt={label} className="max-h-full max-w-full rounded-m object-contain" />
          <button
            aria-label="Close preview"
            className="absolute top-4 right-4 touch-target flex items-center justify-center rounded-full bg-white/15 text-white"
            onClick={() => setZoom(false)}
          >
            <XIcon size={20} />
          </button>
        </div>
      )}
    </div>
  );
}
