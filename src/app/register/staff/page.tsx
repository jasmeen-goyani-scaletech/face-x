'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Topbar from '@/components/layout/Topbar';
import { useRememberActiveRole } from '@/lib/activeRole';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import Chip from '@/components/ui/Chip';
import ModernStepper from '@/components/ui/ModernStepper';
import StepActions from '@/components/ui/StepActions';
import MergedPhotoAndDocsStep from '@/components/registration/MergedPhotoAndDocsStep';
import { TextField, SelectField } from '@/components/ui/Field';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from '@/components/ui/Icons';
import { useLocalStorage } from '@/lib/storage';
import { freshStaffRegistration, STAFF_ROLES, type StaffRegistration, type StaffStep } from '@/lib/types';
import { resolveInvite } from '@/lib/teams';
import { MSG, compact, validatePersonBasics } from '@/lib/validation';
import { useFieldErrors } from '@/lib/useFieldErrors';
import { uploadStepErrors } from '@/lib/uploadStepValidation';

const STEPS = [
  { key: 'basic', label: 'Register' },
  { key: 'proof', label: 'Photo & Proof' },
  { key: 'status', label: 'Status' }
];

const ROLE_CARD_COLOR: Record<string, string> = {
  'Team Manager': 'bg-info-soft text-info border-info',
  'Athletic Trainer': 'bg-danger-soft text-danger border-danger',
  'Equipment Manager': 'bg-gold-soft text-gold border-gold',
  'Safety Officer': 'bg-success-soft text-success border-success'
};

function StaffWizard() {
  const params = useSearchParams();
  const teamId = params.get('teamId');
  const inviteCode = params.get('inviteCode');
  const resolution = resolveInvite(teamId, inviteCode);

  const [reg, setReg, hydrated] = useLocalStorage<StaffRegistration>('facex-staff-registration', freshStaffRegistration(resolution.invite));
  useRememberActiveRole('staff', reg.status, hydrated);
  const [step, setStep] = useState<StaffStep>('basic');
  // Keys equal the input ids, so Continue focuses the first invalid field.
  const { error, blur, submit } = useFieldErrors(
    { ...validatePersonBasics(reg.basic), ...compact({ role: reg.role ? null : MSG.role }) },
    ['firstName', 'lastName', 'phone', 'email', 'role'] as const
  );
  // The photo and every missing required document show their errors at once; Submit focuses the first one.
  // Keys equal the focus-target ids (the capture button and each Upload button).
  const proofStep = uploadStepErrors({ id: 'livePhoto', uploaded: reg.livePhoto.uploaded }, [
    { id: 'backgroundCheckRef', label: 'Background-Check Reference / Proof', required: true, uploaded: reg.backgroundCheckRef.uploaded },
    { id: 'safeSportUpload', label: 'Safe-Sport Compliance Upload', required: false, uploaded: reg.safeSportUpload.uploaded }
  ]);
  const proof = useFieldErrors(proofStep.errors, proofStep.order);

  useEffect(() => {
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

  function goTo(next: StaffStep) {
    setReg({ ...reg, step: next });
    setStep(next);
    window.scrollTo(0, 0);
  }

  function validateBasic() {
    if (submit()) {
      setReg({ ...reg, status: 'draft', step: 'proof' });
      setStep('proof');
      window.scrollTo(0, 0);
    }
  }

  function submitProof() {
    if (!proof.submit()) return;
    const id = `FXS-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    setReg({ ...reg, id, status: 'submitted', createdAt: Date.now(), adminStatus: 'pending', step: 'status' });
    setStep('status');
    window.scrollTo(0, 0);
  }

  return (
    <main>
      <Topbar eyebrow="Staff registration" />
      <div className="mx-auto max-w-[640px] page-gutter pt-6 pb-16">
        {reg.status !== 'submitted' && <ModernStepper steps={STEPS} current={step} />}

        {step === 'basic' && (
          <Card>
            <h2 className="text-xl mb-1">Staff Registration</h2>
            <p className="text-ink-soft mb-5">Personal details and administrative role.</p>

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
            <SelectField
              id="role"
              label="Administrative Role"
              value={reg.role ?? ''}
              error={error('role')}
              onBlur={blur('role')}
              onChange={(e) => setReg({ ...reg, role: e.target.value as StaffRegistration['role'] })}
            >
              <option value="">Select a role</option>
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </SelectField>
            <StepActions onNext={validateBasic} />
          </Card>
        )}

        {step === 'proof' && (
          <MergedPhotoAndDocsStep
            title="Photo & Background Proof"
            info="A live photo and background-check reference are required. The check itself is performed externally."
            photoConfig={{
              id: 'livePhoto',
              label: 'Live staff photo',
              file: reg.livePhoto,
              error: proof.error('livePhoto'),
              onCapture: (dataUrl) =>
                setReg({ ...reg, livePhoto: { uploaded: true, fileName: 'staff-photo.jpg', dataUrl, uploadedAt: Date.now(), review: 'not_submitted' } })
            }}
            documentList={[
              {
                documentId: 'backgroundCheckRef',
                label: 'Background-Check Reference / Proof',
                required: true,
                value: reg.backgroundCheckRef,
                error: proof.error('backgroundCheckRef'),
                onChange: (next) => setReg({ ...reg, backgroundCheckRef: next })
              },
              {
                documentId: 'safeSportUpload',
                label: 'Safe-Sport Compliance Upload',
                required: false,
                value: reg.safeSportUpload,
                onChange: (next) => setReg({ ...reg, safeSportUpload: next })
              }
            ]}
            onBack={() => goTo('basic')}
            onNext={submitProof}
            nextLabel="Submit Registration"
          />
        )}

        {step === 'status' && (
          <Card>
            {reg.adminStatus === 'pending' && (
              <>
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-warning-soft text-warning">
                  <CheckIcon size={26} />
                </div>
                <h2 className="text-xl text-center mb-1">Registration Submitted</h2>
                <p className="text-ink-soft text-center mb-4">
                  Registration for <strong>{reg.basic.firstName} {reg.basic.lastName}</strong> has been received.
                </p>
                <Alert level="warning" title="Pending admin verification">
                  An admin reviews every staff registration before granting event-day access.
                </Alert>
              </>
            )}

            {reg.adminStatus === 'rejected' && (
              <>
                <Alert level="danger" title="Registration rejected">
                  {reg.rejectionReason || 'Your registration was rejected.'}
                </Alert>
                <Button variant="primary" onClick={() => goTo('proof')}>
                  Update & Re-submit
                </Button>
              </>
            )}

            {reg.adminStatus === 'approved' && reg.role && (
              <>
                <h2 className="text-xl text-center mb-1">Staff Approved</h2>
                <p className="text-ink-soft text-center mb-5">Event-day access granted</p>
                <div className={['mx-auto max-w-[280px] rounded-l border-2 p-5 text-center', ROLE_CARD_COLOR[reg.role]].join(' ')}>
                  <div className="text-[11px] font-bold uppercase tracking-wide opacity-80 mb-2">Face-X Staff Card</div>
                  {reg.livePhoto.dataUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={reg.livePhoto.dataUrl} alt="Staff" className="mx-auto mb-2 h-16 w-16 rounded-full object-cover border-2 border-current" />
                  )}
                  <div className="font-display font-bold text-lg">{reg.basic.firstName} {reg.basic.lastName}</div>
                  <div className="text-sm font-semibold">{reg.role}</div>
                  {reg.invite && <div className="text-[11px] opacity-80 mt-1">{reg.invite.teamName}</div>}
                </div>
                <p className="text-center mt-4"><Chip kind="success">Ready for event-day face scan</Chip></p>
              </>
            )}
          </Card>
        )}
      </div>
    </main>
  );
}

export default function StaffRegisterPage() {
  return (
    <Suspense fallback={null}>
      <StaffWizard />
    </Suspense>
  );
}
