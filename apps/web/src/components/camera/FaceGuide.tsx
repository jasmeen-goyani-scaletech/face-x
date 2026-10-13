'use client';

import { AlertTriangleIcon, CheckIcon } from '@/components/ui/Icons';
import type { Guidance } from '@/lib/faceGuidance';
import type { DetectorState } from './useFaceGuidance';

/**
 * What to tell the user right now, or null for nothing. Silence is deliberate: when guidance can't run
 * the camera simply works unguided, so there's no "unavailable" message to puzzle over.
 */
function bannerContent(detector: DetectorState, guidance: Guidance | null): { text: string; tone: 'warn' | 'good' | 'neutral' } | null {
  if (detector === 'loading') return { text: 'Getting ready…', tone: 'neutral' };
  if (detector !== 'ready' || !guidance) return null;
  return { text: guidance.message, tone: guidance.level };
}

/** One short instruction, only when there's something to say. Screen readers announce changes politely. */
export function FaceGuidanceBanner({
  detector,
  guidance,
  pulse = false,
  className = ''
}: {
  detector: DetectorState;
  guidance: Guidance | null;
  /** Briefly emphasise the message (e.g. the user tapped the shutter too early). */
  pulse?: boolean;
  className?: string;
}) {
  const content = bannerContent(detector, guidance);
  return (
    <div role="status" aria-live="polite" className={['flex justify-center', className].join(' ')}>
      {content && (
        <div
          className={[
            'inline-flex max-w-full items-center gap-2 rounded-full px-4 py-2.5 text-center text-[15px] font-semibold leading-snug shadow-lg backdrop-blur-md transition-colors duration-200',
            content.tone === 'good' ? 'bg-[#22c55e] text-[#06130d]' : 'bg-black/65 text-white',
            pulse ? 'animate-pulse' : ''
          ].join(' ')}
        >
          {content.tone === 'good' && <CheckIcon size={18} className="shrink-0" />}
          {content.tone === 'warn' && <AlertTriangleIcon size={18} className="shrink-0 text-[#e3ac4a]" />}
          <span>{content.text}</span>
        </div>
      )}
    </div>
  );
}

/** Thin green edge around the whole camera view once the face is in place — a glanceable "go". */
export function FaceReadyFrame({ ready }: { ready: boolean }) {
  return (
    <div
      aria-hidden
      className={['pointer-events-none absolute inset-0 transition-opacity duration-200', ready ? 'opacity-100' : 'opacity-0'].join(' ')}
      style={{ boxShadow: 'inset 0 0 0 4px #22c55e' }}
    />
  );
}
