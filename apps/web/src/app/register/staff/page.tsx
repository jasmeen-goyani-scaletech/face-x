'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import RegistrationHeader from '@/components/layout/RegistrationHeader';
import RequireAuth from '@/components/auth/RequireAuth';
import { useRememberActiveRole } from '@/lib/activeRole';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import Chip from '@/components/ui/Chip';
import ModernStepper from '@/components/ui/ModernStepper';
import StepActions from '@/components/ui/StepActions';
import MergedPhotoAndDocsStep from '@/components/registration/MergedPhotoAndDocsStep';
import PersonnelEventField from '@/components/registration/PersonnelEventField';
import RegistrationFullCard from '@/components/registration/RegistrationFullCard';
import PersonnelLoadState from '@/components/registration/PersonnelLoadState';
import SaveErrorAlert from '@/components/registration/player/SaveErrorAlert';
import { TextField, SelectField } from '@/components/ui/Field';
import { CheckIcon } from '@/components/ui/Icons';
import { STAFF_ROLES, type StaffRegistration } from '@/lib/types';
import { MSG, compact, validatePersonBasics } from '@/lib/validation';
import { useFieldErrors } from '@/lib/useFieldErrors';
import { uploadStepErrors } from '@/lib/uploadStepValidation';
import { canReplace, needsUpload } from '@/lib/registration/documentMap';
import { useStaffWizard } from '@/lib/registration/usePersonnelWizard';

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
  const w = useStaffWizard({ teamId: params.get('teamId'), inviteCode: params.get('inviteCode'), eventId: params.get('eventId') });
  const { reg, setReg, goTo, files } = w;
  // This page words the second step "proof"; the wizard calls it "certificates" for coach and staff alike.
  const step = w.step === 'certificates' ? 'proof' : w.step;
  useRememberActiveRole('staff', reg.status, w.phase === 'ready');

  // Keys equal the input ids, so Continue focuses the first invalid field.
  const needsEvent = w.invite.status !== 'valid' && w.events.length > 1;
  const { error, blur, submit } = useFieldErrors(
    {
      ...validatePersonBasics(reg.basic),
      ...compact({ role: reg.role ? null : MSG.role, eventId: needsEvent && !w.eventId ? 'Select the event you are registering for.' : null })
    },
    ['firstName', 'lastName', 'phone', 'email', 'role', 'eventId'] as const
  );
  // The photo and every missing required document show their errors at once; Submit focuses the first one.
  // Keys equal the focus-target ids (the capture button and each Upload button).
  const proofStep = uploadStepErrors({ id: 'livePhoto', uploaded: !needsUpload(files.livePhoto) }, [
    { id: 'backgroundCheckRef', label: 'Background-Check Reference / Proof', required: true, uploaded: !needsUpload(files.backgroundCheckRef) },
    { id: 'safeSportUpload', label: 'Safe-Sport Compliance Upload', required: false, uploaded: !needsUpload(files.safeSportUpload) }
  ]);
  const proof = useFieldErrors(proofStep.errors, proofStep.order);

  if (w.phase !== 'ready') return <PersonnelLoadState phase={w.phase} error={w.loadError} onRetry={w.reload} />;
  // A full team shows this instead of the form. Someone who already has a registration keeps it.
  if (w.registration === null && w.invite.status === 'valid' && w.invite.full) return <RegistrationFullCard teamName={w.invite.invite.teamName} kind="staff" />;

  async function validateBasic() {
    if (submit()) await w.saveBasic();
  }

  async function submitProof() {
    if (proof.submit()) await w.submitAll();
  }

  const anyRejected = [files.livePhoto, files.backgroundCheckRef, files.safeSportUpload].some((f) => f.review === 'rejected');
  const photo = files.livePhoto.dataUrl ?? reg.livePhoto.dataUrl;

  return (
    <>
      {reg.status !== 'submitted' && <ModernStepper steps={STEPS} current={step} />}

      {step === 'basic' && (
        <>
          <SaveErrorAlert error={w.saveError} fieldErrors={w.apiFieldErrors} />
          <Card>
            <h2 className="text-xl mb-1">Staff Registration</h2>
            <p className="text-ink-soft mb-5">Personal details and administrative role.</p>

            {w.invite.status === 'valid' && (
              <Alert level="success" title={`Registering for ${w.invite.invite.teamName}`}>
                {w.invite.invite.club} — team is locked to this invite.
              </Alert>
            )}
            {w.invite.status === 'invalid' && (
              <Alert level="warning" title="This invite link isn’t valid">
                You can still register without a team.
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
            <PersonnelEventField
              events={w.events}
              eventId={w.eventId}
              onChange={w.setEventId}
              error={error('eventId')}
              onBlur={blur('eventId')}
              hidden={w.invite.status === 'valid'}
            />
            <StepActions onNext={validateBasic} nextLoading={w.saving} />
          </Card>
        </>
      )}

      {step === 'proof' && (
        <>
          {anyRejected && (
            <Alert level="warning" title="Some files weren’t accepted">
              Staff couldn’t accept one or more files. Please upload a replacement where it says “Not accepted”.
            </Alert>
          )}
          <SaveErrorAlert error={w.saveError} fieldErrors={w.apiFieldErrors} />
          <MergedPhotoAndDocsStep
            title="Photo & Background Proof"
            info="A live photo and background-check reference are required. The check itself is performed externally."
            photoConfig={{
              id: 'livePhoto',
              label: 'Live staff photo',
              file: files.livePhoto,
              error: w.photoError ?? (files.livePhoto.review === 'rejected' ? 'This photo wasn’t accepted. Please retake it.' : proof.error('livePhoto')),
              busy: w.photoBusy,
              locked: !canReplace(files.livePhoto),
              onCapture: (dataUrl) => void w.captureLivePhoto(dataUrl)
            }}
            documentList={[
              {
                documentId: 'backgroundCheckRef',
                label: 'Background-Check Reference / Proof',
                required: true,
                value: files.backgroundCheckRef,
                error: proof.error('backgroundCheckRef'),
                // Files are sent to the server as soon as they're picked; there is nothing to keep in the form.
                onChange: () => undefined,
                upload: (file, onProgress) => w.uploadDocument('backgroundCheckRef', file, file.name, onProgress),
                allowRemove: false,
                canReplace: canReplace(files.backgroundCheckRef)
              },
              {
                documentId: 'safeSportUpload',
                label: 'Safe-Sport Compliance Upload',
                required: false,
                value: files.safeSportUpload,
                onChange: () => undefined,
                upload: (file, onProgress) => w.uploadDocument('safeSportUpload', file, file.name, onProgress),
                allowRemove: false,
                canReplace: canReplace(files.safeSportUpload)
              }
            ]}
            onBack={() => goTo('basic')}
            onNext={() => void submitProof()}
            nextLoading={w.saving}
            nextLabel="Submit Registration"
          />
        </>
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
              {/* A closed registration was turned down as a whole; otherwise only some documents were, and they can be replaced. */}
              <Alert level="danger" title={w.closed ? 'Registration rejected' : 'Documents rejected'}>
                {reg.rejectionReason || (w.closed ? 'Your registration was rejected.' : 'One or more documents were rejected.')}
              </Alert>
              {!w.closed && (
                <Button variant="primary" onClick={() => goTo('certificates')}>
                  Update & Re-submit
                </Button>
              )}
            </>
          )}

          {reg.adminStatus === 'approved' && reg.role && (
            <>
              <h2 className="text-xl text-center mb-1">Staff Approved</h2>
              <p className="text-ink-soft text-center mb-5">Event-day access granted</p>
              <div className={['mx-auto max-w-[280px] rounded-l border-2 p-5 text-center', ROLE_CARD_COLOR[reg.role]].join(' ')}>
                <div className="text-[11px] font-bold uppercase tracking-wide opacity-80 mb-2">Face-X Staff Card</div>
                {photo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo} alt="Staff" className="mx-auto mb-2 h-16 w-16 rounded-full object-cover border-2 border-current" />
                )}
                <div className="font-display font-bold text-lg">{reg.basic.firstName} {reg.basic.lastName}</div>
                <div className="text-sm font-semibold">{reg.role}</div>
                {reg.invite && <div className="text-[11px] opacity-80 mt-1">{reg.invite.teamName}</div>}
              </div>
              <p className="text-center mt-4"><Chip kind="success">Ready for event-day face scan</Chip></p>
              <Link href="/admin/roster" className="mt-5 block no-underline">
                <Button variant="primary" block>
                  View Roster
                </Button>
              </Link>
            </>
          )}
        </Card>
      )}
    </>
  );
}

export default function StaffRegisterPage() {
  return (
    <main>
      <RegistrationHeader role="STAFF" />
      <div className="mx-auto max-w-[640px] page-gutter pt-6 pb-16">
        <Suspense fallback={null}>
          <RequireAuth allowGuest>
            <StaffWizard />
          </RequireAuth>
        </Suspense>
      </div>
    </main>
  );
}
