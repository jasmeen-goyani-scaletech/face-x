'use client';

import { useEffect, useState } from 'react';
import Topbar from '@/components/layout/Topbar';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import Chip from '@/components/ui/Chip';
import StepRail from '@/components/ui/StepRail';
import UploadField from '@/components/ui/UploadField';
import SelfieField from '@/components/camera/SelfieField';
import { TextField, SelectField } from '@/components/ui/Field';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from '@/components/ui/Icons';
import { useLocalStorage } from '@/lib/storage';
import { freshStaffRegistration, STAFF_ROLES, type StaffRegistration, type StaffStep } from '@/lib/types';

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

export default function StaffRegisterPage() {
  const [reg, setReg, hydrated] = useLocalStorage<StaffRegistration>('facex-staff-registration', freshStaffRegistration());
  const [step, setStep] = useState<StaffStep>('basic');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [proofAlert, setProofAlert] = useState(false);

  useEffect(() => {
    if (hydrated) setStep(reg.step || 'basic');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  if (!hydrated) return null;

  function goTo(next: StaffStep) {
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
    if (!reg.role) e.role = 'Select a role';
    if (!reg.clubAffiliation.trim()) e.clubAffiliation = 'Required';
    setErrors(e);
    if (Object.keys(e).length === 0) {
      setReg({ ...reg, status: 'draft', step: 'proof' });
      setStep('proof');
      window.scrollTo(0, 0);
    }
  }

  function submitProof() {
    if (!reg.livePhoto.uploaded || !reg.backgroundCheckRef.uploaded) {
      setProofAlert(true);
      return;
    }
    setProofAlert(false);
    const id = `FXS-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    setReg({ ...reg, id, status: 'submitted', createdAt: Date.now(), adminStatus: 'pending', step: 'status' });
    setStep('status');
    window.scrollTo(0, 0);
  }

  return (
    <main>
      <Topbar eyebrow="Staff registration" />
      <div className="mx-auto max-w-[640px] px-5 pt-6 pb-16">
        {reg.status !== 'submitted' && <StepRail steps={STEPS} current={step} />}

        {step === 'basic' && (
          <Card>
            <h2 className="text-xl mb-1">Staff Registration</h2>
            <p className="text-ink-soft mb-5">Personal details and administrative role.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
              <TextField id="firstName" label="First Name" value={reg.basic.firstName} error={errors.firstName} onChange={(e) => setReg({ ...reg, basic: { ...reg.basic, firstName: e.target.value } })} />
              <TextField id="lastName" label="Last Name" value={reg.basic.lastName} error={errors.lastName} onChange={(e) => setReg({ ...reg, basic: { ...reg.basic, lastName: e.target.value } })} />
              <TextField id="phone" label="Mobile Number" type="tel" value={reg.basic.phone} error={errors.phone} onChange={(e) => setReg({ ...reg, basic: { ...reg.basic, phone: e.target.value } })} />
              <TextField id="email" label="Email" type="email" value={reg.basic.email} error={errors.email} onChange={(e) => setReg({ ...reg, basic: { ...reg.basic, email: e.target.value } })} />
            </div>
            <SelectField id="role" label="Administrative Role" value={reg.role ?? ''} error={errors.role} onChange={(e) => setReg({ ...reg, role: e.target.value as StaffRegistration['role'] })}>
              <option value="">Select a role</option>
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </SelectField>
            <TextField id="club" label="Club Affiliation" value={reg.clubAffiliation} error={errors.clubAffiliation} onChange={(e) => setReg({ ...reg, clubAffiliation: e.target.value })} />
            <div className="flex justify-end mt-2">
              <Button variant="primary" onClick={validateBasic}>
                Continue <ChevronRightIcon size={16} />
              </Button>
            </div>
          </Card>
        )}

        {step === 'proof' && (
          <Card>
            <h2 className="text-xl mb-1">Photo & Background Proof</h2>
            <p className="text-ink-soft mb-4">A live photo and background-check reference are required. The check itself is performed externally.</p>

            <div className="mb-5">
              <SelfieField label="Live staff photo" dataUrl={reg.livePhoto.dataUrl || ''} onCapture={(dataUrl) => setReg({ ...reg, livePhoto: { uploaded: true, fileName: 'staff-photo.jpg', dataUrl, review: 'not_submitted' } })} />
            </div>

            <UploadField label="Background-Check Reference / Proof" value={reg.backgroundCheckRef} onChange={(next) => setReg({ ...reg, backgroundCheckRef: next })} />
            <UploadField label="Safe-Sport Compliance Upload" value={reg.safeSportUpload} onChange={(next) => setReg({ ...reg, safeSportUpload: next })} />

            {proofAlert && <div className="mt-4"><Alert level="danger" title="Missing items">Take your live photo and upload the background-check reference before continuing.</Alert></div>}

            <div className="flex justify-between mt-5">
              <Button variant="secondary" onClick={() => goTo('basic')}>
                <ChevronLeftIcon size={16} /> Back
              </Button>
              <Button variant="primary" onClick={submitProof}>
                Submit Registration <ChevronRightIcon size={16} />
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
                <h2 className="text-xl text-center mb-1">Registration Submitted</h2>
                <p className="text-ink-soft text-center mb-4">Registration #{reg.id}</p>
                <Alert level="warning" title="Pending admin verification">
                  An admin reviews every staff registration before granting event-day access.
                </Alert>
                <div className="rounded-m border border-dashed border-gold bg-gold-soft p-3.5">
                  <div className="text-[11px] font-display font-bold uppercase tracking-wide text-gold mb-2">Demo controls</div>
                  <div className="flex gap-2 flex-wrap">
                    <button type="button" className="rounded-s border border-line-strong bg-surface px-3 py-1.5 text-[12.5px] font-bold" onClick={() => setReg((prev) => ({ ...prev, adminStatus: 'approved' }))}>
                      Approve staff
                    </button>
                    <button type="button" className="rounded-s border border-line-strong bg-surface px-3 py-1.5 text-[12.5px] font-bold" onClick={() => setReg((prev) => ({ ...prev, adminStatus: 'rejected', rejectionReason: 'Background-check reference could not be verified.' }))}>
                      Reject staff
                    </button>
                  </div>
                </div>
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
                  <div className="text-[11px] opacity-80 mt-1">{reg.clubAffiliation}</div>
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
