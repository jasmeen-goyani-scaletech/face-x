'use client';

import type { ReactNode } from 'react';
import Card from '@/components/ui/Card';
import StepHeaderWithInfo from '@/components/ui/StepHeaderWithInfo';
import StepActions from '@/components/ui/StepActions';
import DocumentUploadRow from '@/components/ui/DocumentUploadRow';
import SelfieField from '@/components/camera/SelfieField';
import type { UploadedFile } from '@/lib/types';

export interface PhotoConfig {
  /** Id of the capture button — the key of this field's error, so a failed submit can focus it. */
  id: string;
  label: string;
  /** Heading on the camera dialog. */
  heading?: string;
  /** Current photo; its `dataUrl` is the preview. */
  file: UploadedFile;
  onCapture: (dataUrl: string) => void;
  error?: string | null;
}

export interface DocumentConfig {
  /** Also the id of the row's Upload button and the key of its error. */
  documentId: string;
  label: string;
  hint?: string;
  required: boolean;
  value: UploadedFile;
  onChange: (next: UploadedFile) => void;
  error?: string | null;
}

/**
 * The one "Photo & documents" screen used by player, coach and staff registration: the photo-capture circle on top,
 * the document/certificate rows underneath. The explanatory text lives in an (i) tooltip beside the title, not in a
 * paragraph. It only lays things out. Each flow owns its validation (see
 * `uploadStepErrors` + `useFieldErrors`) and passes the resulting `error` messages down, and decides what `onNext` does.
 * `children` render between the document list and the buttons, for flow-specific extras such as an acknowledgement checkbox.
 */
export default function MergedPhotoAndDocsStep({
  title,
  info,
  photoConfig,
  documentList,
  onNext,
  onBack,
  nextLabel = 'Continue',
  children
}: {
  title: string;
  /** Explanation shown in the (i) tooltip beside the title. */
  info: ReactNode;
  photoConfig: PhotoConfig;
  documentList: DocumentConfig[];
  onNext: () => void;
  onBack: () => void;
  nextLabel?: string;
  children?: ReactNode;
}) {
  return (
    <Card>
      <StepHeaderWithInfo title={title} info={info} />

      <div className="mb-6">
        <SelfieField
          id={photoConfig.id}
          label={photoConfig.label}
          heading={photoConfig.heading}
          error={photoConfig.error}
          dataUrl={photoConfig.file.dataUrl || ''}
          onCapture={photoConfig.onCapture}
        />
      </div>

      <div className="rounded-m border border-line">
        {documentList.map((doc) => (
          <DocumentUploadRow key={doc.documentId} {...doc} />
        ))}
      </div>

      {children}

      <StepActions onBack={onBack} onNext={onNext} nextLabel={nextLabel} />
    </Card>
  );
}
