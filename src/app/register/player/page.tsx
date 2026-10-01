'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Topbar from '@/components/layout/Topbar';
import { useRememberActiveRole } from '@/lib/activeRole';
import ModernStepper from '@/components/ui/ModernStepper';
import { useLocalStorage } from '@/lib/storage';
import { freshPlayerRegistration, type PlayerRegistration, type PlayerStep } from '@/lib/types';
import { calcAge } from '@/lib/age';
import { resolveInvite } from '@/lib/teams';
import BasicInfoStep from '@/components/registration/player/BasicInfoStep';
import DocumentsStep from '@/components/registration/player/DocumentsStep';
import GuardianConsentStep from '@/components/registration/player/GuardianConsentStep';
import PaymentStep from '@/components/registration/player/PaymentStep';
import CompleteStep from '@/components/registration/player/CompleteStep';

const ORDER: PlayerStep[] = ['basic', 'documents', 'guardianConsent', 'payment', 'complete'];

const RAIL: { key: PlayerStep; label: string }[] = [
  { key: 'basic', label: 'Basic Info' },
  { key: 'documents', label: 'Photo & Documents' },
  { key: 'guardianConsent', label: 'Guardian & Consent' },
  { key: 'payment', label: 'Payment' },
  { key: 'complete', label: 'Complete' }
];

// Drafts saved before steps were merged: guardian + consent, and selfie + documents.
const LEGACY_STEPS: Record<string, PlayerStep> = { emergency: 'guardianConsent', consent: 'guardianConsent', selfie: 'documents' };

function PlayerWizard() {
  const params = useSearchParams();
  const teamId = params.get('teamId');
  const inviteCode = params.get('inviteCode');
  const resolution = resolveInvite(teamId, inviteCode);

  const [reg, setReg, hydrated] = useLocalStorage<PlayerRegistration>(
    'facex-player-registration',
    freshPlayerRegistration(resolution.invite)
  );
  useRememberActiveRole('player', reg.status, hydrated);
  const [step, setStep] = useState<PlayerStep>('basic');

  useEffect(() => {
    if (hydrated) setStep(LEGACY_STEPS[reg.step] ?? reg.step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // Attach a resolved invite the first time it's seen, without clobbering a registration already in progress.
  useEffect(() => {
    if (hydrated && resolution.invite && !reg.invite) {
      setReg({ ...reg, invite: resolution.invite });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, resolution.invite]);

  if (!hydrated) return null;

  const age = calcAge(reg.basic.dob);
  const isMinor = age === null || age < 18;

  function goTo(next: PlayerStep) {
    // Functional update: a step that just saved data (e.g. consent) must not be overwritten by a stale `reg`.
    setReg((prev) => ({ ...prev, status: prev.status === 'not_started' ? 'draft' : prev.status, step: next }));
    setStep(next);
    window.scrollTo(0, 0);
  }

  function advanceFrom(current: PlayerStep) {
    goTo(ORDER[ORDER.indexOf(current) + 1]);
  }

  function backFrom(current: PlayerStep) {
    goTo(ORDER[Math.max(0, ORDER.indexOf(current) - 1)]);
  }

  return (
    <main>
      <Topbar role="player" eyebrow={reg.status === 'draft' ? 'Draft in progress' : reg.status === 'submitted' ? undefined : 'New registration'} />
      <div className="mx-auto max-w-[640px] page-gutter pt-6 pb-16">
        {step !== 'complete' && <ModernStepper steps={RAIL} current={step} />}

        {step === 'basic' && (
          <BasicInfoStep reg={reg} onChange={setReg} onNext={() => advanceFrom('basic')} isMinor={isMinor} />
        )}
        {step === 'documents' && (
          <DocumentsStep reg={reg} onChange={setReg} onNext={() => advanceFrom('documents')} onBack={() => backFrom('documents')} />
        )}
        {step === 'guardianConsent' && (
          <GuardianConsentStep
            reg={reg}
            onChange={setReg}
            onNext={() => advanceFrom('guardianConsent')}
            onBack={() => backFrom('guardianConsent')}
            isMinor={isMinor}
          />
        )}
        {step === 'payment' && (
          <PaymentStep
            reg={reg}
            onChange={setReg}
            onBack={() => backFrom('payment')}
          />
        )}
        {step === 'complete' && <CompleteStep reg={reg} />}
      </div>
    </main>
  );
}

export default function PlayerRegisterPage() {
  return (
    <Suspense fallback={null}>
      <PlayerWizard />
    </Suspense>
  );
}
