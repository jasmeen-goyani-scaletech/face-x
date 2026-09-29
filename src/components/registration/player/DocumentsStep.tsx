'use client';

import { useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import UploadField from '@/components/ui/UploadField';
import SelfieField from '@/components/camera/SelfieField';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/ui/Icons';
import type { PlayerRegistration } from '@/lib/types';

export default function DocumentsStep({
  reg,
  onChange,
  onNext,
  onBack
}: {
  reg: PlayerRegistration;
  onChange: (next: PlayerRegistration) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [showAlert, setShowAlert] = useState(false);
  const documentsMissing = !reg.documents.profilePhoto.uploaded || !reg.documents.birthCertificateOrPassport.uploaded;

  function validateAndNext() {
    if (documentsMissing) {
      setShowAlert(true);
      return;
    }
    setShowAlert(false);
    onNext();
  }

  return (
    <Card>
      <h2 className="text-xl mb-1">Face-X Identification & Documents</h2>
      <p className="text-ink-soft mb-5">
        We&rsquo;ll use your selfie for event-day face-scan check-in. Our staff reviews documents manually — this isn&rsquo;t instant.
      </p>

      <div className="mb-6">
        <SelfieField
          label="Face-X identification photo"
          dataUrl={reg.documents.profilePhoto.dataUrl || ''}
          onCapture={(dataUrl) =>
            onChange({
              ...reg,
              documents: {
                ...reg.documents,
                profilePhoto: { uploaded: true, fileName: 'selfie.jpg', dataUrl, review: 'not_submitted' }
              }
            })
          }
        />
      </div>

      <UploadField
        label="Birth Certificate / Passport"
        value={reg.documents.birthCertificateOrPassport}
        onChange={(next) => onChange({ ...reg, documents: { ...reg.documents, birthCertificateOrPassport: next } })}
      />

      {showAlert && documentsMissing && <div className="mt-4"><Alert level="danger" title="Missing items">Take your Face-X photo and upload a birth certificate or passport copy before continuing.</Alert></div>}

      <div className="flex justify-between mt-5">
        <Button variant="secondary" onClick={onBack}>
          <ChevronLeftIcon size={16} /> Back
        </Button>
        <Button variant="primary" onClick={validateAndNext}>
          Continue <ChevronRightIcon size={16} />
        </Button>
      </div>
    </Card>
  );
}
