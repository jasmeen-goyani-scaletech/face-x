'use client';

import MergedPhotoAndDocsStep from '@/components/registration/MergedPhotoAndDocsStep';
import { PLAYER_DOCUMENTS, playerDocument, type PlayerDocumentId } from '@/lib/playerDocuments';
import { uploadStepErrors } from '@/lib/uploadStepValidation';
import { useFieldErrors } from '@/lib/useFieldErrors';
import type { PlayerRegistration, UploadedFile } from '@/lib/types';

type Update = PlayerRegistration | ((prev: PlayerRegistration) => PlayerRegistration);

export default function DocumentsStep({
  reg,
  onChange,
  onNext,
  onBack
}: {
  reg: PlayerRegistration;
  onChange: (next: Update) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const photo = reg.documents.profilePhoto;
  const { errors, order } = uploadStepErrors(
    { id: 'profilePhoto', uploaded: photo.uploaded },
    PLAYER_DOCUMENTS.map((d) => ({ id: d.id, label: d.label, required: d.required, uploaded: playerDocument(reg, d.id).uploaded }))
  );
  const { error, submit } = useFieldErrors(errors, order);

  // Functional updates: uploads finish at different times, and each must build on the latest registration.
  function setDocument(id: 'profilePhoto' | PlayerDocumentId, file: UploadedFile) {
    onChange((prev) => ({ ...prev, documents: { ...prev.documents, [id]: file } }));
  }

  return (
    <MergedPhotoAndDocsStep
      title="Photo & Documents"
      info="We’ll use your selfie for event-day face-scan check-in. Our staff reviews documents manually — this isn’t instant. Birth Certificate, School Transcript and a Kid ID / Government Photo ID are required; School ID is optional."
      photoConfig={{
        id: 'profilePhoto',
        label: 'Face-X identification photo',
        file: photo,
        error: error('profilePhoto'),
        onCapture: (dataUrl) =>
          setDocument('profilePhoto', { uploaded: true, fileName: 'selfie.jpg', dataUrl, uploadedAt: Date.now(), review: 'not_submitted' })
      }}
      documentList={PLAYER_DOCUMENTS.map((doc) => ({
        documentId: doc.id,
        label: doc.label,
        hint: doc.hint,
        required: doc.required,
        value: playerDocument(reg, doc.id),
        onChange: (file) => setDocument(doc.id, file),
        error: error(doc.id)
      }))}
      onBack={onBack}
      onNext={() => submit() && onNext()}
    />
  );
}
