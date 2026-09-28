'use client';

import { useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/ui/Icons';
import type { PlayerRegistration } from '@/lib/types';

export default function EmergencyStep({
  reg,
  onChange,
  onNext,
  onBack
}: {
  reg: PlayerRegistration;
  onChange: (next: PlayerRegistration) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  function set<K extends keyof PlayerRegistration['emergency']>(key: K, value: PlayerRegistration['emergency'][K]) {
    onChange({ ...reg, emergency: { ...reg.emergency, [key]: value } });
  }

  function validateAndNext() {
    const em = reg.emergency;
    const e: Record<string, string> = {};
    if (!em.guardianName.trim()) e.guardianName = 'Required';
    if (!em.guardianPhone.trim() || em.guardianPhone.replace(/\D/g, '').length < 7) e.guardianPhone = 'Enter a valid phone number';
    if (!em.emergencyContactName.trim()) e.emergencyContactName = 'Required';
    if (!em.emergencyContactPhone.trim() || em.emergencyContactPhone.replace(/\D/g, '').length < 7) e.emergencyContactPhone = 'Enter a valid phone number';
    setErrors(e);
    if (Object.keys(e).length === 0) onNext();
  }

  return (
    <Card>
      <h2 className="text-xl mb-1">Guardian & Emergency Contact</h2>
      <p className="text-ink-soft mb-5">Required for athletes under 18.</p>

      <h3 className="text-[12px] text-ink-faint tracking-wide mb-2">Parent / Guardian</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <TextField id="guardianName" label="Guardian Full Name" value={reg.emergency.guardianName} error={errors.guardianName} onChange={(e) => set('guardianName', e.target.value)} />
        <TextField id="relationship" label="Relationship" optional placeholder="Mother, Father, Legal Guardian" value={reg.emergency.relationship} onChange={(e) => set('relationship', e.target.value)} />
        <TextField id="guardianPhone" label="Guardian Mobile" type="tel" value={reg.emergency.guardianPhone} error={errors.guardianPhone} onChange={(e) => set('guardianPhone', e.target.value)} />
        <TextField id="guardianEmail" label="Guardian Email" type="email" optional value={reg.emergency.guardianEmail} onChange={(e) => set('guardianEmail', e.target.value)} />
      </div>

      <h3 className="text-[12px] text-ink-faint tracking-wide mb-2 mt-4">Emergency Contact (if different)</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <TextField id="ecName" label="Contact Name" value={reg.emergency.emergencyContactName} error={errors.emergencyContactName} onChange={(e) => set('emergencyContactName', e.target.value)} />
        <TextField id="ecPhone" label="Contact Phone" type="tel" value={reg.emergency.emergencyContactPhone} error={errors.emergencyContactPhone} onChange={(e) => set('emergencyContactPhone', e.target.value)} />
      </div>

      <div className="flex justify-between mt-2">
        <Button variant="secondary" onClick={onBack}>
          <ChevronLeftIcon size={16} /> Back
        </Button>
        <Button variant="primary" onClick={validateAndNext}>
          Continue <ChevronRightIcon size={16} />
        </Button>
      </div>
    </Card>
  );
}
