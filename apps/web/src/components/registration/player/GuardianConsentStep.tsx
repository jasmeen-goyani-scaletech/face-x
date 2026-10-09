'use client';

import Card from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import StepActions from '@/components/ui/StepActions';
import { TextField } from '@/components/ui/Field';
import { FieldError } from '@/components/ui/FormFieldWrapper';
import Checkbox from '@/components/ui/Checkbox';
import GuestCountInput from '@/components/ui/GuestCountInput';
import { clampGuestCount, validateGuardianConsent, type GuardianField } from '@/lib/guardianValidation';
import { useFieldErrors } from '@/lib/useFieldErrors';
import { formatDate } from '@/lib/format';
import type { ApiConsentVersion } from '@/lib/api/types';
import type { PlayerRegistration } from '@/lib/types';
import SaveErrorAlert from './SaveErrorAlert';

type Update = PlayerRegistration | ((prev: PlayerRegistration) => PlayerRegistration);

const FIELD_ORDER: GuardianField[] = ['guardianName', 'relationship', 'guardianPhone', 'guardianEmail', 'agree', 'signedName'];

export default function GuardianConsentStep({
  reg,
  onChange,
  onNext,
  onBack,
  isMinor,
  wording,
  guardianSaved,
  consentRecorded,
  locked,
  saving,
  saveError,
  apiFieldErrors
}: {
  reg: PlayerRegistration;
  onChange: (next: Update) => void;
  onNext: () => void;
  onBack: () => void;
  isMinor: boolean;
  /** The consent wording the league has published. Null until it exists: a minor can't continue without it. */
  wording: ApiConsentVersion | null;
  /** The guardian is already stored with the player (the API has no edit for it), so those fields are read-only. */
  guardianSaved: boolean;
  /** The current wording was already accepted for this registration. */
  consentRecorded: boolean;
  /** Submitted: nothing here can be changed any more. */
  locked: boolean;
  saving: boolean;
  saveError: string | null;
  apiFieldErrors: Record<string, string>;
}) {
  const g = reg.emergency;
  const c = reg.consent;
  // Errors are derived from the registration on every render; useFieldErrors decides which are visible (after blur or submit).
  // That also re-checks the signature match when the guardian name changes.
  const { error, blur, submit } = useFieldErrors<GuardianField>(isMinor ? validateGuardianConsent(reg) : {}, FIELD_ORDER);
  const guests = clampGuestCount(g.guestCount ?? 0); // default 0
  const noWording = isMinor && !wording && !consentRecorded;
  const readOnlyGuardian = guardianSaved || locked;

  function setGuardian(patch: Partial<PlayerRegistration['emergency']>) {
    onChange((prev) => ({ ...prev, emergency: { ...prev.emergency, ...patch } }));
  }

  function setConsent(patch: Partial<PlayerRegistration['consent']>) {
    onChange((prev) => ({ ...prev, consent: { ...prev.consent, ...patch } }));
  }

  function validateAndNext() {
    // Adults (18+) only provide the guest count; guardian details and the waiver apply to minors.
    if (!isMinor || locked) return onNext();
    if (!submit()) return;
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

      {locked && (
        <Alert level="info" title="Registration submitted">
          This registration has been submitted, so these details can’t be changed here.
        </Alert>
      )}
      {noWording && (
        <Alert level="warning" title="Consent wording isn’t available yet">
          The league hasn’t published the guardian consent yet, so this step can’t be completed. Please check back soon — your progress is saved.
        </Alert>
      )}
      <SaveErrorAlert error={saveError} fieldErrors={apiFieldErrors} />

      <fieldset disabled={locked || saving} className="m-0 min-w-0 border-0 p-0">
        {isMinor && (
          <>
            <h3 className="text-[12px] text-ink-faint tracking-wide mb-2">Parent / Guardian</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
              <TextField
                id="guardianName"
                label="Parent/Guardian Full Name"
                autoComplete="name"
                value={g.guardianName}
                disabled={readOnlyGuardian}
                error={error('guardianName')}
                onBlur={blur('guardianName')}
                onChange={(e) => setGuardian({ guardianName: e.target.value })}
              />
              <TextField
                id="relationship"
                label="Relationship to Player"
                placeholder="Parent, Legal Guardian"
                value={g.relationship}
                disabled={readOnlyGuardian}
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
                disabled={readOnlyGuardian}
                error={error('guardianPhone')}
                onBlur={blur('guardianPhone')}
                onChange={(e) => setGuardian({ guardianPhone: e.target.value })}
              />
              <TextField
                id="guardianEmail"
                label="Parent Email Address"
                type="email"
                autoComplete="email"
                value={g.guardianEmail}
                readOnly
                hint="This is the email you signed in with. Updates are sent here."
                error={error('guardianEmail')}
                onBlur={blur('guardianEmail')}
                onChange={() => undefined}
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

        {isMinor && wording && (
          <div className="border-t border-line pt-5">
            <h3 className="text-[12px] text-ink-faint tracking-wide mb-2">Liability Release & Waiver</h3>
            {consentRecorded && (
              <Alert level="success" title="Consent recorded">
                Accepted{c.completedAt ? ` on ${formatDate(new Date(c.completedAt).toISOString().slice(0, 10))}` : ''} by {c.signedName}.
              </Alert>
            )}
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
                  disabled={consentRecorded}
                  invalid={!!error('agree')}
                  aria-describedby="agree-error"
                  onBlur={blur('agree')}
                  onChange={(e) => setConsent({ agree: e.target.checked })}
                />
                <span>
                  {wording.body}
                  <span aria-hidden="true" className="ml-0.5 text-field-error">
                    *
                  </span>
                </span>
              </label>
              {error('agree') && (
                <FieldError id="agree-error" className="mt-2">
                  {error('agree')}
                </FieldError>
              )}
            </div>
            <TextField
              id="signedName"
              label="Type your full name to sign"
              autoComplete="off"
              value={c.signedName}
              disabled={consentRecorded}
              error={error('signedName')}
              onBlur={blur('signedName')}
              onChange={(e) => setConsent({ signedName: e.target.value })}
            />
          </div>
        )}
      </fieldset>

      <StepActions onBack={onBack} onNext={validateAndNext} nextLoading={saving} nextDisabled={noWording} />
    </Card>
  );
}
