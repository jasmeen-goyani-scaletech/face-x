'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Topbar from '@/components/layout/Topbar';
import { useRememberActiveRole } from '@/lib/activeRole';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import ModernStepper from '@/components/ui/ModernStepper';
import StepActions from '@/components/ui/StepActions';
import MergedPhotoAndDocsStep from '@/components/registration/MergedPhotoAndDocsStep';
import { TextField } from '@/components/ui/Field';
import { FieldError } from '@/components/ui/FormFieldWrapper';
import Checkbox from '@/components/ui/Checkbox';
import { CheckIcon } from '@/components/ui/Icons';
import { useLocalStorage } from '@/lib/storage';
import { emptyFile, freshCoachRegistration, type CoachRegistration, type CoachStep } from '@/lib/types';
import { resolveInvite } from '@/lib/teams';
import { genId } from '@/lib/format';
import CoachApprovalConfirmation from '@/components/coach/CoachApprovalConfirmation';
import { MSG, compact, validatePersonBasics } from '@/lib/validation';
import { useFieldErrors } from '@/lib/useFieldErrors';
import { uploadStepErrors } from '@/lib/uploadStepValidation';

const STEPS = [
  { key: 'basic', label: 'Register' },
  { key: 'certificates', label: 'Photo & Certificates' },
  { key: 'status', label: 'Status' }
];

function CoachWizard() {
  const params = useSearchParams();
  const teamId = params.get('teamId');
  const inviteCode = params.get('inviteCode');
  const resolution = resolveInvite(teamId, inviteCode);

  const [reg, setReg, hydrated] = useLocalStorage<CoachRegistration>('facex-coach-registration', freshCoachRegistration(resolution.invite));
  useRememberActiveRole('coach', reg.status, hydrated);
  const [step, setStep] = useState<CoachStep>('basic');
  // Keys equal the input ids, so Continue focuses the first invalid field.
  const { error, blur, submit } = useFieldErrors(validatePersonBasics(reg.basic), ['firstName', 'lastName', 'phone', 'email'] as const);
  // The photo and every missing certificate show their errors at once; Submit focuses the first one. Keys equal the
  // focus-target ids (the capture button, each Upload button, the AB 506 checkbox).
  const certs = reg.certificates;
  const livePhoto = reg.livePhoto ?? emptyFile();
  const certStep = uploadStepErrors({ id: 'livePhoto', uploaded: livePhoto.uploaded }, [
    { id: 'firstAidCpr', label: 'First Aid / CPR Certificate', required: true, uploaded: certs.firstAidCpr.uploaded },
    { id: 'yalfTackle', label: 'YALF Tackle Certificate', required: true, uploaded: certs.yalfTackle.uploaded },
    { id: 'backgroundCheckRef', label: 'Live Scan Background Check (reference / proof)', required: true, uploaded: certs.backgroundCheckRef.uploaded }
  ]);
  const cert = useFieldErrors(
    { ...certStep.errors, ...compact({ ab506: reg.ab506Acknowledged ? null : 'Check the box to acknowledge AB 506 compliance.' }) },
    [...certStep.order, 'ab506']
  );

  useEffect(() => {
    // A registration saved before `step` existed on this type has it as `undefined` — fall back
    // to 'basic' rather than rendering a blank screen for anyone with older stale storage.
    if (hydrated) setStep(reg.step || 'basic');
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

  function goTo(next: CoachStep) {
    setReg({ ...reg, step: next });
    setStep(next);
    window.scrollTo(0, 0);
  }

  function validateBasic() {
    if (submit()) {
      setReg({ ...reg, status: 'draft', step: 'certificates' });
      setStep('certificates');
      window.scrollTo(0, 0);
    }
  }

  function submitCertificates() {
    if (!cert.submit()) return;
    const id = `FXC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    setReg({ ...reg, id, status: 'submitted', createdAt: Date.now(), adminStatus: 'pending', step: 'status' });
    setStep('status');
    window.scrollTo(0, 0);
  }

  function createTeam(name: string) {
    // A coach who already has a team (joined through a team link, or made one) never makes a second.
    if (reg.invite || reg.team || !name.trim()) return;
    const teamId = `CAL-${genId('TEAM')}`;
    const inviteCode = `COACH-${Math.floor(100 + Math.random() * 900)}`;
    setReg({ ...reg, team: { teamId, teamName: name.trim(), club: name.trim(), inviteCode } });
  }

  return (
    <main>
      <Topbar role="coach" eyebrow="Coach registration" />
      <div className="mx-auto max-w-[640px] page-gutter pt-6 pb-16">
        {reg.status !== 'submitted' && <ModernStepper steps={STEPS} current={step} />}

        {step === 'basic' && (
          <Card>
            <h2 className="text-xl mb-1">Coach Registration</h2>
            <p className="text-ink-soft mb-5">Personal details only — no payment required.</p>

            {reg.invite && (
              <Alert level="success" title={`Registering for ${reg.invite.teamName}`}>
                {reg.invite.club} — team is locked to this invite.
              </Alert>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
              <TextField
                id="firstName"
                label="First Name"
                value={reg.basic.firstName}
                error={error('firstName')}
                onBlur={blur('firstName')}
                onChange={(e) => setReg({ ...reg, basic: { ...reg.basic, firstName: e.target.value } })}
              />
              <TextField
                id="lastName"
                label="Last Name"
                value={reg.basic.lastName}
                error={error('lastName')}
                onBlur={blur('lastName')}
                onChange={(e) => setReg({ ...reg, basic: { ...reg.basic, lastName: e.target.value } })}
              />
              <TextField
                id="phone"
                label="Mobile Number"
                type="tel"
                value={reg.basic.phone}
                error={error('phone')}
                onBlur={blur('phone')}
                onChange={(e) => setReg({ ...reg, basic: { ...reg.basic, phone: e.target.value } })}
              />
              <TextField
                id="email"
                label="Email"
                type="email"
                value={reg.basic.email}
                error={error('email')}
                onBlur={blur('email')}
                onChange={(e) => setReg({ ...reg, basic: { ...reg.basic, email: e.target.value } })}
              />
            </div>
            <StepActions onNext={validateBasic} />
          </Card>
        )}

        {step === 'certificates' && (
          <MergedPhotoAndDocsStep
            title="Photo & Certificates"
            info="Take a live photo and upload all three certificates. If anything is missing, your status stays Pending until it’s uploaded."
            photoConfig={{
              id: 'livePhoto',
              label: 'Live coach photo',
              file: livePhoto,
              error: cert.error('livePhoto'),
              onCapture: (dataUrl) =>
                setReg({ ...reg, livePhoto: { uploaded: true, fileName: 'coach-photo.jpg', dataUrl, uploadedAt: Date.now(), review: 'not_submitted' } })
            }}
            documentList={[
              {
                documentId: 'firstAidCpr',
                label: 'First Aid / CPR Certificate',
                required: true,
                value: certs.firstAidCpr,
                error: cert.error('firstAidCpr'),
                onChange: (next) => setReg({ ...reg, certificates: { ...reg.certificates, firstAidCpr: next } })
              },
              {
                documentId: 'yalfTackle',
                label: 'YALF Tackle Certificate',
                required: true,
                value: certs.yalfTackle,
                error: cert.error('yalfTackle'),
                onChange: (next) => setReg({ ...reg, certificates: { ...reg.certificates, yalfTackle: next } })
              },
              {
                documentId: 'backgroundCheckRef',
                label: 'Live Scan Background Check (reference / proof)',
                required: true,
                value: certs.backgroundCheckRef,
                error: cert.error('backgroundCheckRef'),
                onChange: (next) => setReg({ ...reg, certificates: { ...reg.certificates, backgroundCheckRef: next } })
              }
            ]}
            onBack={() => goTo('basic')}
            onNext={submitCertificates}
            nextLabel="Submit Certificates"
          >
            <label className="flex gap-2.5 items-start text-[13.5px] text-ink-soft mt-4">
              <Checkbox
                id="ab506"
                className="mt-0.5"
                invalid={!!cert.error('ab506')}
                aria-describedby="ab506-error"
                checked={reg.ab506Acknowledged}
                onChange={(e) => setReg({ ...reg, ab506Acknowledged: e.target.checked })}
              />
              I acknowledge California Child Abuse Prevention Act (AB 506) compliance requirements and consent to a background check.
            </label>
            {cert.error('ab506') && (
              <FieldError id="ab506-error" className="mt-1.5">
                {cert.error('ab506')}
              </FieldError>
            )}
          </MergedPhotoAndDocsStep>
        )}

        {step === 'status' && (
          <Card>
            {reg.adminStatus === 'pending' && (
              <>
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-warning-soft text-warning">
                  <CheckIcon size={26} />
                </div>
                <h2 className="text-xl text-center mb-1">Certificates Submitted</h2>
                <p className="text-ink-soft text-center mb-4">
                  Registration for <strong>{reg.basic.firstName} {reg.basic.lastName}</strong> has been received.
                </p>
                <Alert level="warning" title="Pending admin verification">
                  Our admin team reviews certificates manually. You&rsquo;ll be notified once you&rsquo;re approved for event-day access.
                </Alert>
              </>
            )}

            {reg.adminStatus === 'rejected' && (
              <>
                <Alert level="danger" title="Certificates rejected">
                  {reg.rejectionReason || 'One or more certificates were rejected.'} Re-upload them for another review.
                </Alert>
                <Button variant="primary" onClick={() => goTo('certificates')}>
                  Re-upload Certificates
                </Button>
              </>
            )}

            {reg.adminStatus === 'approved' && <CoachApprovalConfirmation reg={reg} onCreateTeam={createTeam} />}
          </Card>
        )}
      </div>
    </main>
  );
}

export default function CoachRegisterPage() {
  return (
    <Suspense fallback={null}>
      <CoachWizard />
    </Suspense>
  );
}
