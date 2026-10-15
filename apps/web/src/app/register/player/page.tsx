'use client';

import { Suspense, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import RegistrationHeader from '@/components/layout/RegistrationHeader';
import RequireAuth from '@/components/auth/RequireAuth';
import { useAuth } from '@/components/auth/AuthProvider';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import RegistrationFullCard from '@/components/registration/RegistrationFullCard';
import ModernStepper from '@/components/ui/ModernStepper';
import type { PlayerStep } from '@/lib/types';
import { usePlayerWizard } from '@/lib/registration/usePlayerWizard';
import BasicInfoStep from '@/components/registration/player/BasicInfoStep';
import DocumentsStep from '@/components/registration/player/DocumentsStep';
import GuardianConsentStep from '@/components/registration/player/GuardianConsentStep';
import PaymentStep from '@/components/registration/player/PaymentStep';
import CompleteStep from '@/components/registration/player/CompleteStep';

// Guardian & Consent comes before Photo & Documents: the API needs the guardian to create a minor's player record,
// and a registration has to exist before any document can be uploaded to it.
const RAIL: { key: PlayerStep; label: string }[] = [
  { key: 'basic', label: 'Basic Info' },
  { key: 'guardianConsent', label: 'Guardian & Consent' },
  { key: 'documents', label: 'Photo & Documents' },
  { key: 'payment', label: 'Payment' },
  { key: 'complete', label: 'Complete' }
];

function PlayerWizard() {
  const params = useSearchParams();
  const { user } = useAuth();
  const w = usePlayerWizard({
    teamId: params.get('teamId'),
    inviteCode: params.get('inviteCode'),
    eventId: params.get('eventId'),
    registrationId: params.get('registrationId'),
    startNew: params.get('new') === '1',
    paymentOutcome: params.get('payment')
  });
  const { setReg, reg, phase, registration } = w;

  // The guardian's email is the account's: the API records the account holder as the guardian.
  useEffect(() => {
    if (phase === 'ready' && user && reg.emergency.guardianEmail !== user.email) {
      setReg((prev) => ({ ...prev, emergency: { ...prev.emergency, guardianEmail: user.email } }));
    }
  }, [phase, user, reg.emergency.guardianEmail, setReg]);

  if (phase === 'loading') {
    return (
      <Card className="text-center">
        <span className="mx-auto mb-4 block h-8 w-8 rounded-full border-[3px] border-primary border-t-transparent animate-spin" aria-hidden />
        <p role="status" className="m-0 text-ink-soft">
          Loading your registration…
        </p>
      </Card>
    );
  }
  if (phase === 'error') {
    return (
      <Card className="text-center">
        <Alert level="danger" title="We couldn’t load your registration">
          {w.loadError}
        </Alert>
        <Button variant="primary" onClick={w.reload}>
          Try again
        </Button>
      </Card>
    );
  }

  // A full team shows this instead of the form. Someone who already has a registration keeps it.
  if (registration === null && w.invite.status === 'valid' && w.invite.full) return <RegistrationFullCard teamName={w.invite.invite.teamName} kind="player" />;

  const { step } = w;
  const consentRequirement = w.consents?.requirements.find((r) => r.code === 'GUARDIAN_CONSENT');

  return (
    <>
      {step !== 'complete' && <ModernStepper steps={RAIL} current={step} />}

      {w.notice && (
        <Alert level={w.notice.level} title={w.notice.title}>
          {w.notice.text}
        </Alert>
      )}

      {step === 'basic' && (
        <BasicInfoStep
          reg={reg}
          onChange={setReg}
          onNext={() => void w.saveBasic()}
          isMinor={w.isMinor}
          events={w.events}
          eventId={w.eventId}
          onEventChange={w.setEventId}
          teams={w.teams}
          invite={w.invite}
          hasRegistration={registration !== null}
          locked={w.locked}
          saving={w.saving}
          saveError={w.saveError}
          apiFieldErrors={w.apiFieldErrors}
        />
      )}
      {step === 'guardianConsent' && (
        <GuardianConsentStep
          reg={reg}
          onChange={setReg}
          onNext={() => void w.saveGuardianConsent()}
          onBack={() => w.goTo('basic')}
          isMinor={w.isMinor}
          wording={w.consentWording}
          guardianSaved={registration !== null && registration.guardians.length > 0}
          consentRecorded={consentRequirement?.accepted === true}
          locked={w.locked}
          guest={!user}
          saving={w.saving}
          saveError={w.saveError}
          apiFieldErrors={w.apiFieldErrors}
        />
      )}
      {step === 'documents' && (
        <DocumentsStep
          documents={w.documents}
          onUpload={w.uploadDocument}
          onNext={() => void w.finishDocuments()}
          onBack={() => w.goTo('guardianConsent')}
          saving={w.saving}
          saveError={w.saveError}
          apiFieldErrors={w.apiFieldErrors}
        />
      )}
      {step === 'payment' && registration && (
        <PaymentStep
          registration={registration}
          payment={w.payment}
          onStart={() => void w.startPayment()}
          onContinue={() => w.goTo('complete')}
          onBack={() => w.goTo('documents')}
          saving={w.saving}
          saveError={w.saveError}
          apiFieldErrors={w.apiFieldErrors}
        />
      )}
      {step === 'complete' && registration && (
        <>
          <CompleteStep registration={registration} payment={w.payment} />
          <p className="mt-4 text-center text-[13px] text-ink-faint">
            Registering another player?{' '}
            <Link href="/register/player?new=1" className="font-bold text-primary-strong">
              Start a new registration
            </Link>
          </p>
        </>
      )}
    </>
  );
}

export default function PlayerRegisterPage() {
  return (
    <main>
      <RegistrationHeader role="PLAYER" />
      <div className="mx-auto max-w-[640px] page-gutter pt-6 pb-16">
        <Suspense fallback={null}>
          <RequireAuth allowGuest>
            <PlayerWizard />
          </RequireAuth>
        </Suspense>
      </div>
    </main>
  );
}
