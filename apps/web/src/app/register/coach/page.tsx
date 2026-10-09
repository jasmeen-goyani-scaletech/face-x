'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import RegistrationHeader from '@/components/layout/RegistrationHeader';
import RequireAuth from '@/components/auth/RequireAuth';
import { useRememberActiveRole } from '@/lib/activeRole';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import ModernStepper from '@/components/ui/ModernStepper';
import StepActions from '@/components/ui/StepActions';
import MergedPhotoAndDocsStep from '@/components/registration/MergedPhotoAndDocsStep';
import PersonnelEventField from '@/components/registration/PersonnelEventField';
import PersonnelLoadState from '@/components/registration/PersonnelLoadState';
import SaveErrorAlert from '@/components/registration/player/SaveErrorAlert';
import { TextField } from '@/components/ui/Field';
import { FieldError } from '@/components/ui/FormFieldWrapper';
import Checkbox from '@/components/ui/Checkbox';
import { CheckIcon } from '@/components/ui/Icons';
import CoachApprovalConfirmation from '@/components/coach/CoachApprovalConfirmation';
import { MSG, compact, validatePersonBasics } from '@/lib/validation';
import { useFieldErrors } from '@/lib/useFieldErrors';
import { uploadStepErrors } from '@/lib/uploadStepValidation';
import { canReplace, needsUpload } from '@/lib/registration/documentMap';
import { useCoachWizard } from '@/lib/registration/usePersonnelWizard';

const STEPS = [
  { key: 'basic', label: 'Register' },
  { key: 'certificates', label: 'Photo & Certificates' },
  { key: 'status', label: 'Status' }
];

function CoachWizard() {
  const params = useSearchParams();
  const w = useCoachWizard({ teamId: params.get('teamId'), inviteCode: params.get('inviteCode'), eventId: params.get('eventId') });
  const { reg, setReg, step, goTo, files } = w;
  useRememberActiveRole('coach', reg.status, w.phase === 'ready');

  // Keys equal the input ids, so Continue focuses the first invalid field.
  const needsEvent = w.invite.status !== 'valid' && w.events.length > 1;
  const { error, blur, submit } = useFieldErrors(
    { ...validatePersonBasics(reg.basic), ...compact({ eventId: needsEvent && !w.eventId ? 'Select the event you are registering for.' : null }) },
    ['firstName', 'lastName', 'phone', 'email', 'eventId'] as const
  );
  // The photo and every missing certificate show their errors at once; Submit focuses the first one. Keys equal the
  // focus-target ids (the capture button, each Upload button, the AB 506 checkbox).
  const certStep = uploadStepErrors({ id: 'livePhoto', uploaded: !needsUpload(files.livePhoto) }, [
    { id: 'firstAidCpr', label: 'First Aid / CPR Certificate', required: true, uploaded: !needsUpload(files.firstAidCpr) },
    { id: 'yalfTackle', label: 'YALF Tackle Certificate', required: true, uploaded: !needsUpload(files.yalfTackle) },
    { id: 'backgroundCheckRef', label: 'Live Scan Background Check (reference / proof)', required: true, uploaded: !needsUpload(files.backgroundCheckRef) }
  ]);
  const cert = useFieldErrors(
    { ...certStep.errors, ...compact({ ab506: reg.ab506Acknowledged ? null : 'Check the box to acknowledge AB 506 compliance.' }) },
    [...certStep.order, 'ab506']
  );

  if (w.phase !== 'ready') return <PersonnelLoadState phase={w.phase} error={w.loadError} onRetry={w.reload} />;

  async function validateBasic() {
    if (submit()) await w.saveBasic();
  }

  async function submitCertificates() {
    if (cert.submit()) await w.submitAll();
  }

  const anyRejected = [files.livePhoto, files.firstAidCpr, files.yalfTackle, files.backgroundCheckRef].some((f) => f.review === 'rejected');

  return (
    <>
      {reg.status !== 'submitted' && <ModernStepper steps={STEPS} current={step} />}

      {step === 'basic' && (
        <>
          <SaveErrorAlert error={w.saveError} fieldErrors={w.apiFieldErrors} />
          <Card>
            <h2 className="text-xl mb-1">Coach Registration</h2>
            <p className="text-ink-soft mb-5">Personal details only — no payment required.</p>

            {w.invite.status === 'valid' && (
              <Alert level="success" title={`Registering for ${w.invite.invite.teamName}`}>
                {w.invite.invite.club} — team is locked to this invite.
              </Alert>
            )}
            {w.invite.status === 'invalid' && (
              <Alert level="warning" title="This invite link isn’t valid">
                You can still register; you’ll be able to create or join a team once you’re approved.
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

      {step === 'certificates' && (
        <>
          {anyRejected && (
            <Alert level="warning" title="Some files weren’t accepted">
              Staff couldn’t accept one or more files. Please upload a replacement where it says “Not accepted”.
            </Alert>
          )}
          <SaveErrorAlert error={w.saveError} fieldErrors={w.apiFieldErrors} />
          <MergedPhotoAndDocsStep
            title="Photo & Certificates"
            info="Take a live photo and upload all three certificates. If anything is missing, your status stays Pending until it’s uploaded."
            photoConfig={{
              id: 'livePhoto',
              label: 'Live coach photo',
              file: files.livePhoto,
              error: w.photoError ?? (files.livePhoto.review === 'rejected' ? 'This photo wasn’t accepted. Please retake it.' : cert.error('livePhoto')),
              busy: w.photoBusy,
              locked: !canReplace(files.livePhoto),
              onCapture: (dataUrl) => void w.captureLivePhoto(dataUrl)
            }}
            documentList={[
              {
                documentId: 'firstAidCpr',
                label: 'First Aid / CPR Certificate',
                required: true,
                value: files.firstAidCpr,
                error: cert.error('firstAidCpr'),
                // Files are sent to the server as soon as they're picked; there is nothing to keep in the form.
                onChange: () => undefined,
                upload: (file, onProgress) => w.uploadDocument('firstAidCpr', file, file.name, onProgress),
                allowRemove: false,
                canReplace: canReplace(files.firstAidCpr)
              },
              {
                documentId: 'yalfTackle',
                label: 'YALF Tackle Certificate',
                required: true,
                value: files.yalfTackle,
                error: cert.error('yalfTackle'),
                onChange: () => undefined,
                upload: (file, onProgress) => w.uploadDocument('yalfTackle', file, file.name, onProgress),
                allowRemove: false,
                canReplace: canReplace(files.yalfTackle)
              },
              {
                documentId: 'backgroundCheckRef',
                label: 'Live Scan Background Check (reference / proof)',
                required: true,
                value: files.backgroundCheckRef,
                error: cert.error('backgroundCheckRef'),
                onChange: () => undefined,
                upload: (file, onProgress) => w.uploadDocument('backgroundCheckRef', file, file.name, onProgress),
                allowRemove: false,
                canReplace: canReplace(files.backgroundCheckRef)
              }
            ]}
            onBack={() => goTo('basic')}
            onNext={() => void submitCertificates()}
            nextLoading={w.saving}
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
        </>
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
                {reg.rejectionReason || 'One or more certificates were rejected.'} {!w.closed && 'Re-upload them for another review.'}
              </Alert>
              {!w.closed && (
                <Button variant="primary" onClick={() => goTo('certificates')}>
                  Re-upload Certificates
                </Button>
              )}
            </>
          )}

          {reg.adminStatus === 'approved' && <CoachApprovalConfirmation />}
        </Card>
      )}
    </>
  );
}

export default function CoachRegisterPage() {
  return (
    <main>
      <RegistrationHeader role="COACH" />
      <div className="mx-auto max-w-[640px] page-gutter pt-6 pb-16">
        <Suspense fallback={null}>
          <RequireAuth>
            <CoachWizard />
          </RequireAuth>
        </Suspense>
      </div>
    </main>
  );
}
