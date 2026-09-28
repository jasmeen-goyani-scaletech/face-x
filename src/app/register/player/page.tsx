'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Topbar from '@/components/layout/Topbar';
import StepRail from '@/components/ui/StepRail';
import { useLocalStorage } from '@/lib/storage';
import { freshPlayerRegistration, type PlayerRegistration, type PlayerStep } from '@/lib/types';
import { calcAge } from '@/lib/age';
import { resolveInvite } from '@/lib/teams';
import BasicInfoStep from '@/components/registration/player/BasicInfoStep';
import EmergencyStep from '@/components/registration/player/EmergencyStep';
import DocumentsStep from '@/components/registration/player/DocumentsStep';
import ConsentStep from '@/components/registration/player/ConsentStep';
import PaymentStep from '@/components/registration/player/PaymentStep';
import CompleteStep from '@/components/registration/player/CompleteStep';

const STEPS: { key: PlayerStep; label: string }[] = [
  { key: 'basic', label: 'Basic Info' },
  { key: 'emergency', label: 'Guardian' },
  { key: 'documents', label: 'Documents' },
  { key: 'consent', label: 'Consent' },
  { key: 'payment', label: 'Payment' },
  { key: 'complete', label: 'Complete' }
];

function PlayerWizard() {
  const params = useSearchParams();
  const teamId = params.get('teamId');
  const inviteCode = params.get('inviteCode');
  const resolution = resolveInvite(teamId, inviteCode);

  const [reg, setReg, hydrated] = useLocalStorage<PlayerRegistration>(
    'facex-player-registration',
    freshPlayerRegistration(resolution.invite)
  );
  const [step, setStep] = useState<PlayerStep>('basic');

  useEffect(() => {
    if (hydrated) setStep(reg.step);
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
    setReg({ ...reg, status: reg.status === 'not_started' ? 'draft' : reg.status, step: next });
    setStep(next);
    window.scrollTo(0, 0);
  }

  function advanceFrom(current: PlayerStep) {
    const order = STEPS.map((s) => s.key);
    let idx = order.indexOf(current) + 1;
    // Skip the guardian/emergency step entirely for adult players.
    if (order[idx] === 'emergency' && !isMinor) idx++;
    goTo(order[idx]);
  }

  function backFrom(current: PlayerStep) {
    const order = STEPS.map((s) => s.key);
    let idx = order.indexOf(current) - 1;
    if (order[idx] === 'emergency' && !isMinor) idx--;
    goTo(order[Math.max(0, idx)]);
  }

  const visibleSteps = STEPS.filter((s) => s.key !== 'emergency' || isMinor);

  return (
    <main>
      <Topbar eyebrow={reg.status === 'submitted' ? `Registration #${reg.id}` : reg.status === 'draft' ? 'Draft in progress' : 'New registration'} />
      <div className="mx-auto max-w-[640px] px-5 pt-6 pb-16">
        {step !== 'complete' && <StepRail steps={visibleSteps} current={step} />}

        {step === 'basic' && (
          <BasicInfoStep reg={reg} onChange={setReg} onNext={() => advanceFrom('basic')} isMinor={isMinor} age={age} />
        )}
        {step === 'emergency' && isMinor && (
          <EmergencyStep reg={reg} onChange={setReg} onNext={() => advanceFrom('emergency')} onBack={() => backFrom('emergency')} />
        )}
        {step === 'documents' && (
          <DocumentsStep reg={reg} onChange={setReg} onNext={() => advanceFrom('documents')} onBack={() => backFrom('documents')} />
        )}
        {step === 'consent' && (
          <ConsentStep reg={reg} onChange={setReg} onNext={() => advanceFrom('consent')} onBack={() => backFrom('consent')} isMinor={isMinor} />
        )}
        {step === 'payment' && (
          <PaymentStep
            reg={reg}
            onChange={setReg}
            onBack={() => backFrom('payment')}
            onComplete={() => {
              const id = `FX-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
              setReg({ ...reg, id, status: 'submitted', completedAt: Date.now(), step: 'complete' });
              setStep('complete');
              window.scrollTo(0, 0);
            }}
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
