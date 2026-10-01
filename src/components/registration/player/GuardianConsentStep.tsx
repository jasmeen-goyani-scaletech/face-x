'use client';

import Card from '@/components/ui/Card';
import StepActions from '@/components/ui/StepActions';
import { TextField } from '@/components/ui/Field';
import { FieldError } from '@/components/ui/FormFieldWrapper';
import Checkbox from '@/components/ui/Checkbox';
import GuestCountInput from '@/components/ui/GuestCountInput';
import { clampGuestCount, validateGuardianConsent, type GuardianField } from '@/lib/guardianValidation';
import { useFieldErrors } from '@/lib/useFieldErrors';
import type { PlayerRegistration } from '@/lib/types';

type Update = PlayerRegistration | ((prev: PlayerRegistration) => PlayerRegistration);

export const WAIVER_TEXT =
  'I am the parent or legal guardian of this player. I consent to their participation in this camp and agree to the event-day ' +
  'face-scan check-in. I acknowledge and agree that the organization, its staff, and event organizers shall not be held liable ' +
  'for any injuries, accidents, or claims arising from participation in this event.';

const FIELD_ORDER: GuardianField[] = ['guardianName', 'relationship', 'guardianPhone', 'guardianEmail', 'agree', 'signedName'];

export default function GuardianConsentStep({
  reg,
  onChange,
  onNext,
  onBack,
  isMinor
}: {
  reg: PlayerRegistration;
  onChange: (next: Update) => void;
  onNext: () => void;
  onBack: () => void;
  isMinor: boolean;
}) {
  const g = reg.emergency;
  const c = reg.consent;
  // Errors are derived from the registration on every render; useFieldErrors decides which are visible (after blur or submit).
  // That also re-checks the signature match when the guardian name changes.
  const { error, blur, submit } = useFieldErrors<GuardianField>(isMinor ? validateGuardianConsent(reg) : {}, FIELD_ORDER);
  const guests = clampGuestCount(g.guestCount ?? 0); // default 0, also for drafts saved before this field existed

  function setGuardian(patch: Partial<PlayerRegistration['emergency']>) {
    onChange((prev) => ({ ...prev, emergency: { ...prev.emergency, ...patch } }));
  }

  function setConsent(patch: Partial<PlayerRegistration['consent']>) {
    onChange((prev) => ({ ...prev, consent: { ...prev.consent, ...patch } }));
  }

  function validateAndNext() {
    // Adults (18+) only provide the guest count; guardian details and the waiver apply to minors.
    if (!isMinor) {
      onChange((prev) => ({ ...prev, consent: { ...prev.consent, required: false } }));
      return onNext();
    }
    if (!submit()) return;
    setConsent({ required: true, method: 'inline', status: 'completed', completedAt: Date.now() });
    onNext();
  }

  return (
    <Card>
      <h2 className="text-xl mb-1">Guardian & Consent</h2>
      <p className="text-ink-soft mb-5">
        {isMinor
          ? 'A parent or legal guardian completes this step. All fields are required.'
          : 'This player is 18 or older — no guardian consent is needed. Just tell us who is coming.'}
      </p>

      {isMinor && (
        <>
          <h3 className="text-[12px] text-ink-faint tracking-wide mb-2">Parent / Guardian</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            <TextField
              id="guardianName"
              label="Parent/Guardian Full Name"
              autoComplete="name"
              value={g.guardianName}
              error={error('guardianName')}
              onBlur={blur('guardianName')}
              onChange={(e) => setGuardian({ guardianName: e.target.value })}
            />
            <TextField
              id="relationship"
              label="Relationship to Player"
              placeholder="Parent, Legal Guardian"
              value={g.relationship}
              error={error('relationship')}
              onBlur={blur('relationship')}
              onChange={(e) => setGuardian({ relationship: e.target.value })}
            />
            <TextField
              id="guardianPhone"
              label="Parent Contact Phone"
              type="tel"
              autoComplete="tel"
              placeholder="555-019-2831"
              value={g.guardianPhone}
              error={error('guardianPhone')}
              onBlur={blur('guardianPhone')}
              onChange={(e) => setGuardian({ guardianPhone: e.target.value })}
            />
            <TextField
              id="guardianEmail"
              label="Parent Email Address"
              type="email"
              autoComplete="email"
              placeholder="name@example.com"
              value={g.guardianEmail}
              error={error('guardianEmail')}
              onBlur={blur('guardianEmail')}
              onChange={(e) => setGuardian({ guardianEmail: e.target.value })}
            />
          </div>
        </>
      )}

      <GuestCountInput
        id="guestCount"
        label="Number of additional parents/guests attending with player"
        value={guests}
        onChange={(n) => setGuardian({ guestCount: n })}
      />

      {isMinor && (
        <div className="border-t border-line pt-5">
          <h3 className="text-[12px] text-ink-faint tracking-wide mb-2">Liability Release & Waiver</h3>
          <div
            className={[
              'rounded-m border bg-surface-2 px-4 py-3.5 mb-4 transition-colors',
              error('agree') ? 'border-field-error' : 'border-line-strong'
            ].join(' ')}
          >
            <label className="flex gap-2.5 items-start text-[13.5px] text-ink-soft">
              <Checkbox
                id="agree"
                className="mt-0.5"
                checked={c.agree}
                invalid={!!error('agree')}
                aria-describedby="agree-error"
                onBlur={blur('agree')}
                onChange={(e) => setConsent({ agree: e.target.checked })}
              />
              <span>
                {WAIVER_TEXT}
                <span aria-hidden="true" className="ml-0.5 text-field-error">
                  *
                </span>
              </span>
            </label>
            {error('agree') && <FieldError id="agree-error" className="mt-2">{error('agree')}</FieldError>}
          </div>
          <TextField
            id="signedName"
            label="Type your full name to sign"
            autoComplete="off"
            value={c.signedName}
            error={error('signedName')}
            onBlur={blur('signedName')}
            onChange={(e) => setConsent({ signedName: e.target.value })}
          />
        </div>
      )}

      <StepActions onBack={onBack} onNext={validateAndNext} />
    </Card>
  );
}
