'use client';

import { useState } from 'react';
import MergedPhotoAndDocsStep from '@/components/registration/MergedPhotoAndDocsStep';
import Alert from '@/components/ui/Alert';
import { PLAYER_DOCUMENTS } from '@/lib/playerDocuments';
import { describeError } from '@/lib/api/errors';
import { canReplace, needsUpload, type PlayerDocumentKey } from '@/lib/registration/documentMap';
import { uploadStepErrors } from '@/lib/uploadStepValidation';
import { useFieldErrors } from '@/lib/useFieldErrors';
import type { UploadedFile } from '@/lib/types';
import SaveErrorAlert from './SaveErrorAlert';

export default function DocumentsStep({
  documents,
  onUpload,
  onNext,
  onBack,
  saving,
  saveError,
  apiFieldErrors
}: {
  /** What the server holds for each document (plus a preview for files added in this visit). */
  documents: Record<PlayerDocumentKey, UploadedFile>;
  /** Stores a file for real: resolves when the server has checked it, throws an Error fit to show if it fails. */
  onUpload: (key: PlayerDocumentKey, file: File | Blob, fileName: string, onProgress: (percent: number) => void) => Promise<void>;
  onNext: () => void;
  onBack: () => void;
  saving: boolean;
  saveError: string | null;
  apiFieldErrors: Record<string, string>;
}) {
  const [selfieBusy, setSelfieBusy] = useState(false);
  const [selfieError, setSelfieError] = useState<string | null>(null);

  const photo = documents.profilePhoto;
  const { errors, order } = uploadStepErrors(
    { id: 'profilePhoto', uploaded: !needsUpload(photo) },
    PLAYER_DOCUMENTS.map((d) => ({ id: d.id, label: d.label, required: d.required, uploaded: !needsUpload(documents[d.id]) }))
  );
  const { error, submit } = useFieldErrors(errors, order);

  async function capture(dataUrl: string) {
    setSelfieError(null);
    setSelfieBusy(true);
    try {
      const blob = await (await fetch(dataUrl)).blob();
      await onUpload('profilePhoto', blob, 'selfie.jpg', () => undefined);
    } catch (e) {
      setSelfieError(describeError(e, e instanceof Error ? e.message : undefined));
    } finally {
      setSelfieBusy(false);
    }
  }

  const photoRejected = photo.review === 'rejected';
  const anyRejected = photoRejected || PLAYER_DOCUMENTS.some((d) => documents[d.id].review === 'rejected');

  return (
    <>
      {anyRejected && (
        <Alert level="warning" title="Some files weren’t accepted">
          Staff couldn’t accept one or more files. Please upload a replacement where it says “Not accepted”.
        </Alert>
      )}
      <SaveErrorAlert error={saveError} fieldErrors={apiFieldErrors} />
      <MergedPhotoAndDocsStep
        title="Photo & Documents"
        info="We’ll use your selfie for event-day face-scan check-in. Our staff reviews documents manually — this isn’t instant. Birth Certificate, School Transcript and a Kid ID / Government Photo ID are required; School ID is optional."
        photoConfig={{
          id: 'profilePhoto',
          label: 'Face-X identification photo',
          file: photo,
          error: selfieError ?? (photoRejected ? 'This photo wasn’t accepted. Please retake it.' : error('profilePhoto')),
          busy: selfieBusy,
          locked: !canReplace(photo),
          onCapture: (dataUrl) => void capture(dataUrl)
        }}
        documentList={PLAYER_DOCUMENTS.map((doc) => ({
          documentId: doc.id,
          label: doc.label,
          hint: doc.hint,
          required: doc.required,
          value: documents[doc.id],
          // Files are sent to the server as soon as they're picked; there is nothing to keep in the form.
          onChange: () => undefined,
          upload: (file, onProgress) => onUpload(doc.id, file, file.name, onProgress),
          allowRemove: false,
          canReplace: canReplace(documents[doc.id]),
          error: error(doc.id)
        }))}
        onBack={onBack}
        onNext={() => submit() && onNext()}
        nextLoading={saving}
      />
    </>
  );
}
