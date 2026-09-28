'use client';

import { useEffect, useState } from 'react';
import Topbar from '@/components/layout/Topbar';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import Chip from '@/components/ui/Chip';
import StepRail from '@/components/ui/StepRail';
import UploadField from '@/components/ui/UploadField';
import { TextField } from '@/components/ui/Field';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, LinkIcon } from '@/components/ui/Icons';
import { useLocalStorage } from '@/lib/storage';
import { freshCoachRegistration, type CoachRegistration, type CoachStep } from '@/lib/types';
import { generateInviteLink } from '@/lib/teams';
import { genId } from '@/lib/format';

const STEPS = [
  { key: 'basic', label: 'Register' },
  { key: 'certificates', label: 'Certificates' },
  { key: 'status', label: 'Status' }
];

export default function CoachRegisterPage() {
  const [reg, setReg, hydrated] = useLocalStorage<CoachRegistration>('facex-coach-registration', freshCoachRegistration());
  const [step, setStep] = useState<CoachStep>('basic');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [certAlert, setCertAlert] = useState(false);
  const [teamName, setTeamName] = useState('');

  useEffect(() => {
    // A registration saved before `step` existed on this type has it as `undefined` — fall back
    // to 'basic' rather than rendering a blank screen for anyone with older stale storage.
    if (hydrated) setStep(reg.step || 'basic');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  if (!hydrated) return null;

  function goTo(next: CoachStep) {
    setReg({ ...reg, step: next });
    setStep(next);
    window.scrollTo(0, 0);
  }

  function validateBasic() {
    const e: Record<string, string> = {};
    if (!reg.basic.firstName.trim()) e.firstName = 'Required';
    if (!reg.basic.lastName.trim()) e.lastName = 'Required';
    if (!reg.basic.phone.trim() || reg.basic.phone.replace(/\D/g, '').length < 7) e.phone = 'Enter a valid phone number';
    if (!reg.basic.email.trim() || !reg.basic.email.includes('@')) e.email = 'Enter a valid email';
    setErrors(e);
    if (Object.keys(e).length === 0) {
      setReg({ ...reg, status: 'draft', step: 'certificates' });
      setStep('certificates');
      window.scrollTo(0, 0);
    }
  }

  function submitCertificates() {
    const c = reg.certificates;
    const allUploaded = c.firstAidCpr.uploaded && c.yalfTackle.uploaded && c.backgroundCheckRef.uploaded;
    if (!allUploaded || !reg.ab506Acknowledged) {
      setCertAlert(true);
      return;
    }
    setCertAlert(false);
    const id = `FXC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    setReg({ ...reg, id, status: 'submitted', createdAt: Date.now(), adminStatus: 'pending', step: 'status' });
    setStep('status');
    window.scrollTo(0, 0);
  }

  function createTeam() {
    if (!teamName.trim()) return;
    const teamId = `CAL-${genId('TEAM')}`;
    const inviteCode = `COACH-${Math.floor(100 + Math.random() * 900)}`;
    setReg({ ...reg, team: { teamId, teamName: teamName.trim(), club: teamName.trim(), inviteCode } });
  }

  return (
    <main>
      <Topbar eyebrow="Coach registration" />
      <div className="mx-auto max-w-[640px] px-5 pt-6 pb-16">
        {reg.status !== 'submitted' && <StepRail steps={STEPS} current={step} />}

        {step === 'basic' && (
          <Card>
            <h2 className="text-xl mb-1">Coach Registration</h2>
            <p className="text-ink-soft mb-5">Personal details only — no payment required.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
              <TextField id="firstName" label="First Name" value={reg.basic.firstName} error={errors.firstName} onChange={(e) => setReg({ ...reg, basic: { ...reg.basic, firstName: e.target.value } })} />
              <TextField id="lastName" label="Last Name" value={reg.basic.lastName} error={errors.lastName} onChange={(e) => setReg({ ...reg, basic: { ...reg.basic, lastName: e.target.value } })} />
              <TextField id="phone" label="Mobile Number" type="tel" value={reg.basic.phone} error={errors.phone} onChange={(e) => setReg({ ...reg, basic: { ...reg.basic, phone: e.target.value } })} />
              <TextField id="email" label="Email" type="email" value={reg.basic.email} error={errors.email} onChange={(e) => setReg({ ...reg, basic: { ...reg.basic, email: e.target.value } })} />
            </div>
            <div className="flex justify-end mt-2">
              <Button variant="primary" onClick={validateBasic}>
                Continue <ChevronRightIcon size={16} />
              </Button>
            </div>
          </Card>
        )}

        {step === 'certificates' && (
          <Card>
            <h2 className="text-xl mb-1">Upload Certificates</h2>
            <p className="text-ink-soft mb-4">
              All three are required. If anything is missing, your status stays Pending until it&rsquo;s uploaded.
            </p>
            <UploadField label="First Aid / CPR Certificate" value={reg.certificates.firstAidCpr} onChange={(next) => setReg({ ...reg, certificates: { ...reg.certificates, firstAidCpr: next } })} />
            <UploadField label="YALF Tackle Certificate" value={reg.certificates.yalfTackle} onChange={(next) => setReg({ ...reg, certificates: { ...reg.certificates, yalfTackle: next } })} />
            <UploadField label="Live Scan Background Check (reference / proof)" value={reg.certificates.backgroundCheckRef} onChange={(next) => setReg({ ...reg, certificates: { ...reg.certificates, backgroundCheckRef: next } })} />

            <label className="flex gap-2.5 items-start text-[13.5px] text-ink-soft mt-4">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={reg.ab506Acknowledged}
                onChange={(e) => setReg({ ...reg, ab506Acknowledged: e.target.checked })}
              />
              I acknowledge California Child Abuse Prevention Act (AB 506) compliance requirements and consent to a background check.
            </label>

            {certAlert && <div className="mt-4"><Alert level="danger" title="Certificates incomplete">Upload all three documents and acknowledge AB 506 compliance to submit.</Alert></div>}

            <div className="flex justify-between mt-5">
              <Button variant="secondary" onClick={() => goTo('basic')}>
                <ChevronLeftIcon size={16} /> Back
              </Button>
              <Button variant="primary" onClick={submitCertificates}>
                Submit Certificates <ChevronRightIcon size={16} />
              </Button>
            </div>
          </Card>
        )}

        {step === 'status' && (
          <Card>
            {reg.adminStatus === 'pending' && (
              <>
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-warning-soft text-warning">
                  <CheckIcon size={26} />
                </div>
                <h2 className="text-xl text-center mb-1">Certificates Submitted</h2>
                <p className="text-ink-soft text-center mb-4">Registration #{reg.id}</p>
                <Alert level="warning" title="Pending admin verification">
                  Our admin team reviews certificates manually. You&rsquo;ll be notified once you&rsquo;re approved for event-day access.
                </Alert>
                <div className="rounded-m border border-dashed border-gold bg-gold-soft p-3.5">
                  <div className="text-[11px] font-display font-bold uppercase tracking-wide text-gold mb-2">Demo controls</div>
                  <div className="flex gap-2 flex-wrap">
                    <button type="button" className="rounded-s border border-line-strong bg-surface px-3 py-1.5 text-[12.5px] font-bold" onClick={() => setReg((prev) => ({ ...prev, adminStatus: 'approved' }))}>
                      Approve coach
                    </button>
                    <button type="button" className="rounded-s border border-line-strong bg-surface px-3 py-1.5 text-[12.5px] font-bold" onClick={() => setReg((prev) => ({ ...prev, adminStatus: 'rejected', rejectionReason: 'YALF Tackle certificate expired.' }))}>
                      Reject coach
                    </button>
                  </div>
                </div>
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

            {reg.adminStatus === 'approved' && (
              <>
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success-soft text-success border-2 border-success">
                  <CheckIcon size={26} />
                </div>
                <h2 className="text-xl text-center mb-1">Coach Approved</h2>
                <p className="text-ink-soft text-center mb-4"><Chip kind="success">Event-day access granted</Chip></p>

                <h3 className="text-[13px] tracking-wide mb-2 mt-2">Create a Team</h3>
                <p className="text-[13px] text-ink-soft mb-3">Generate a shareable invite link players can use to register directly onto your roster.</p>
                {reg.team ? (
                  <div className="rounded-m bg-accent-soft p-3.5">
                    <div className="font-bold text-accent-strong text-sm mb-1">{reg.team.teamName}</div>
                    <div className="text-[12.5px] break-all text-ink-soft flex items-center gap-1.5">
                      <LinkIcon size={13} /> {generateInviteLink(reg.team.teamId, reg.team.inviteCode)}
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      className="flex-1 rounded-s border border-line-strong px-3 py-2 text-sm"
                      placeholder="Team name (e.g. Sacramento U14 Hawks)"
                      value={teamName}
                      onChange={(e) => setTeamName(e.target.value)}
                    />
                    <Button variant="primary" onClick={createTeam}>
                      Create
                    </Button>
                  </div>
                )}
              </>
            )}
          </Card>
        )}
      </div>
    </main>
  );
}
