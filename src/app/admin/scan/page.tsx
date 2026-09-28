'use client';

import { useState } from 'react';
import CameraCaptureModal from '@/components/camera/CameraCaptureModal';
import VerificationHud from '@/components/admin/VerificationHud';
import { AlertCircleIcon, CameraIcon } from '@/components/ui/Icons';
import { useEventRoster } from '@/lib/roster';

type ScanMode = 'face' | 'qr';

export default function AdminScanPage() {
  const roster = useEventRoster();
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [mode, setMode] = useState<ScanMode>('face');
  const [resultId, setResultId] = useState<string | null | undefined>(undefined);
  const [choice, setChoice] = useState('');
  const candidates = roster.roster.filter((r) => !r.checkedInAt);

  function onCaptured() {
    setOpen(false);
    setScanning(true);
    setTimeout(() => {
      setScanning(false);
      const target = choice || (candidates[0]?.id ?? '__none__');
      setResultId(target === '__none__' ? null : target);
    }, 1100);
  }

  const matched = resultId ? roster.roster.find((r) => r.id === resultId) : null;

  return (
    <div>
      <h1 className="font-display text-2xl uppercase tracking-wide mb-1">Event-Day Scanner</h1>
      <p className="text-[#9fb0a6] text-sm mb-5">Fall Tackle Kickoff Night · November 14, 2026</p>

      <div className="flex rounded-xl border border-[#253029] bg-[#12181f] p-1 mb-5">
        <ModeButton active={mode === 'face'} onClick={() => setMode('face')} label="Face Scan" />
        <ModeButton active={mode === 'qr'} onClick={() => setMode('qr')} label="QR Scan" />
      </div>

      <div className="rounded-2xl border border-[#253029] bg-[#12181f] p-6 text-center mb-5">
        {scanning ? (
          <>
            <div className="mx-auto mb-4 h-56 w-56 rounded-full bg-[#1c2620] border-4 border-[#22c55e] flex items-center justify-center animate-pulse">
              <CameraIcon size={40} className="text-[#22c55e]" />
            </div>
            <p className="text-[#9fb0a6] font-semibold">Matching {mode === 'face' ? 'face' : 'QR code'}…</p>
          </>
        ) : (
          <>
            <div className="mx-auto mb-5 h-56 w-56 rounded-full border-4 border-dashed border-[#2d3a33] flex items-center justify-center">
              <CameraIcon size={40} className="text-[#4a5850]" />
            </div>
            <button
              onClick={() => setOpen(true)}
              className="w-full flex items-center justify-center gap-2.5 rounded-xl bg-[#22c55e] text-[#06130d] font-bold uppercase tracking-wide py-5 text-base active:translate-y-px"
            >
              <CameraIcon size={20} /> {mode === 'face' ? 'Scan Face' : 'Scan QR Code'}
            </button>
          </>
        )}
      </div>

      <div className="rounded-2xl border border-dashed border-[#4d3c14] bg-[#1a1610] p-4 mb-5">
        <div className="text-[11px] font-display font-bold uppercase tracking-wide text-[#e3ac4a] mb-2">Demo control</div>
        <p className="text-[#c9b184] text-[12.5px] mb-2">Choose what the scan should find, then tap Scan.</p>
        <select
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className="w-full rounded-lg border border-[#4d3c14] bg-[#12181f] text-white px-3 py-2.5 text-sm"
        >
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              Match: {c.firstName} {c.lastName}
            </option>
          ))}
          <option value="__none__">No match found</option>
        </select>
      </div>

      {resultId === undefined && (
        <div className="rounded-2xl border border-dashed border-[#2d3a33] p-10 text-center text-[#6b7a71]">
          <CameraIcon size={36} className="mx-auto mb-3" />
          Scan a registrant to see their verification status here.
        </div>
      )}
      {resultId === null && (
        <div className="rounded-2xl border border-[#5c2323] bg-[#2a1414] p-5 flex gap-3">
          <AlertCircleIcon size={20} className="text-[#f87171] shrink-0" />
          <div>
            <div className="font-bold text-[#f87171]">No match found</div>
            <p className="text-[#e0a8a8] text-[13px] m-0 mt-0.5">Use Manual Search to find them by name, date of birth, or school ID.</p>
          </div>
        </div>
      )}
      {matched && <VerificationHud entry={matched} method={mode === 'face' ? 'Face Scan' : 'QR Scan'} onConfirm={roster.markPresent} />}

      <CameraCaptureModal
        open={open}
        heading={mode === 'face' ? 'Position your face in the frame' : 'Position the QR code in the frame'}
        onClose={() => setOpen(false)}
        onCapture={onCaptured}
      />
    </div>
  );
}

function ModeButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={[
        'flex-1 rounded-lg py-2.5 font-display font-bold uppercase tracking-wide text-[12.5px]',
        active ? 'bg-[#22c55e] text-[#06130d]' : 'text-[#9fb0a6]'
      ].join(' ')}
    >
      {label}
    </button>
  );
}
