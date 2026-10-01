'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { AlertTriangleIcon, CameraIcon, CheckIcon, ChevronLeftIcon, RefreshIcon, SearchIcon } from '@/components/ui/Icons';
import IconButton from '@/components/ui/IconButton';
import { FaceGuidanceBanner, FaceReadyFrame } from '@/components/camera/FaceGuide';
import { useFaceGuidance } from '@/components/camera/useFaceGuidance';
import { useScannerCamera } from '@/components/camera/useScannerCamera';
import ManualCheckInDialog from './ManualCheckInDialog';
import RoleFilterTabs, { ROLE_FILTER_LABEL, type RoleFilter } from './RoleFilterTabs';
import VerificationHud from './VerificationHud';
import { entryAccessState } from '@/lib/accessCompliance';
import { getFaceMatcher, isAutoGrantSafe } from '@/lib/faceMatcher';
import { formatTime, initialsOf } from '@/lib/format';
import { useEventRoster } from '@/lib/roster';
import { EVENT_INFO } from '@/lib/seed';
import type { RosterEntry } from '@/lib/seed';

/** How long the green "User Verified" banner stays up before the scanner is ready for the next person. */
const VERIFIED_BANNER_MS = 1500;

const ROLE_LABEL: Record<RosterEntry['role'], string> = { player: 'Player', coach: 'Coach', staff: 'Staff' };

type Phase = 'idle' | 'comparing' | 'failed' | 'unavailable' | 'review';

/**
 * Event-day check-in screen: a full-width page with the live viewfinder beside the review and activity panel.
 *
 * Verifying someone is an explicit action, not something the camera does on its own:
 *   1. The camera is live as soon as the page opens. Staff frame one face and press **Scan & Verify Face**.
 *   2. The current frame is captured and compared against the registered photos ("Comparing face…").
 *   3. Match, fully clear  → checked in, "User Verified: Name (Role • Team)" for 1.5 s, activity list updates, ready again.
 *      Match, not clear    → blocked by compliance / already in / payment incomplete: shown beside the camera. A blocked
 *                            person cannot be checked in (no override); the block is resolved on their profile.
 *      No match            → "Face Match Failed" with **Try Manual Search & Approve**.
 *      No matcher at all   → "Face matching isn't set up": nothing was compared, so it says so rather than "no match".
 * **Manual Search & Approve** (top right) is always there as the bypass: find the person, compare their on-file photo with
 * who is standing there, confirm. It works with no camera and no matcher.
 *
 * Face identification is a plug-in (lib/faceMatcher.ts). The built-in matcher is a simulation, on only in Demo Mode.
 */
export default function AdminScanScreen() {
  const { roster, markPresent } = useEventRoster();
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const scoped = useMemo(() => (roleFilter === 'all' ? roster : roster.filter((r) => r.role === roleFilter)), [roster, roleFilter]);
  // The async match must see the latest roster, not the one from when the button was pressed.
  const rosterRef = useRef(roster);
  rosterRef.current = roster;
  const scopedRef = useRef(scoped);
  scopedRef.current = scoped;

  const matcher = useMemo(() => getFaceMatcher(), []);
  const cam = useScannerCamera();
  const face = useFaceGuidance({ active: cam.status === 'live', videoRef: cam.videoRef, frameRef: cam.frameRef });
  const faceReady = face.detector === 'ready' && face.guidance?.code === 'good';

  const [phase, setPhase] = useState<Phase>('idle');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [nudge, setNudge] = useState(false);
  const [banner, setBanner] = useState<{ text: string; tag?: string } | null>(null);
  const [reviewEntry, setReviewEntry] = useState<RosterEntry | null>(null);

  const runId = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };
  useEffect(() => {
    const pending = timers.current;
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally bumping the live counter so an in-flight match can't act after unmount
      runId.current++;
      pending.forEach(clearTimeout);
    };
  }, []);

  /** Check someone in, confirm it on screen for 1.5 s, and hand the camera back for the next person. */
  function checkIn(entry: RosterEntry, method: 'Face Scan' | 'Manual') {
    markPresent(entry.id, method, false);
    setReviewEntry(null);
    setPhase('idle');
    setBanner({
      text: `User Verified: ${entry.firstName} ${entry.lastName} (${ROLE_LABEL[entry.role]} • ${entry.teamName || 'No team'})`,
      tag: method === 'Manual' ? 'Manual' : matcher?.isDemo ? 'Demo match' : undefined
    });
    later(() => setBanner(null), VERIFIED_BANNER_MS);
  }

  function scanAndVerify() {
    if (cam.status !== 'live' || phase === 'comparing' || dialogOpen || banner) return;
    setReviewEntry(null);
    // The detector says the face isn't ready (too far, off-centre, moving…): flash the instruction instead of comparing a poor frame.
    if (face.detector === 'ready' && !faceReady) {
      setPhase('idle');
      setNudge(true);
      later(() => setNudge(false), 1200);
      return;
    }
    const frame = cam.capture();
    if (!frame) return;
    // Nothing is plugged in to compare faces, so nothing is compared. Say that, instead of claiming "no match".
    if (!matcher) return setPhase('unavailable');

    const mine = ++runId.current;
    setPhase('comparing');
    matcher
      .match(frame, scopedRef.current)
      .then((result) => {
        if (mine !== runId.current) return; // the manual dialog opened, or we unmounted
        const entry = result ? rosterRef.current.find((r) => r.id === result.id) : undefined;
        if (!entry) return setPhase('failed');
        if (isAutoGrantSafe(entry)) return checkIn(entry, 'Face Scan');
        setReviewEntry(entry);
        setPhase('review');
      })
      .catch(() => {
        if (mine === runId.current) setPhase('failed');
      });
  }

  function openManual() {
    runId.current++; // abandon any comparison in flight
    setPhase('idle');
    setDialogOpen(true);
  }

  function confirmManual(id: string) {
    const entry = rosterRef.current.find((r) => r.id === id);
    setDialogOpen(false);
    if (entry) checkIn(entry, 'Manual');
  }

  const live = cam.status === 'live';
  const busy = phase === 'comparing' || !!banner || dialogOpen;
  const detectorDown = face.detector === 'unavailable';
  const scope = roleFilter === 'all' ? '' : ` · ${ROLE_FILTER_LABEL[roleFilter]} only`;
  const status: { ok: boolean; text: string } = !matcher
    ? { ok: false, text: 'Face matching isn’t enabled on this device. Scan & Verify can’t identify anyone yet; use Manual Search & Approve.' }
    : matcher.isDemo
      ? { ok: true, text: `Demo matching active${scope}: simulated, with no real face comparison.` }
      : { ok: true, text: `Face matching active${scope}. Frame one face, then press Scan & Verify Face.` };

  const checkedIn = scoped.filter((r) => r.checkedInAt).sort((a, b) => (b.checkedInAt ?? 0) - (a.checkedInAt ?? 0));
  const waiting = scoped.filter((r) => entryAccessState(r) === 'enabled' && !r.checkedInAt).length;

  return (
    <div className="w-full min-w-0">
      <Link href="/admin/event-day" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft no-underline hover:text-ink">
        <ChevronLeftIcon size={16} /> Back to Event Day
      </Link>

      {/* Header bar: title on the left; role filter and the manual bypass on the right */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="m-0 text-2xl">Event-Day Scanner</h1>
          <p className="m-0 mt-1 text-sm text-ink-soft">
            {EVENT_INFO.name} · {EVENT_INFO.time}
          </p>
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-3 sm:w-auto sm:justify-end">
          <RoleFilterTabs value={roleFilter} onChange={setRoleFilter} />
          <Button variant="secondary" className="w-full sm:w-auto" onClick={openManual}>
            <SearchIcon size={16} /> Manual Search & Approve
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0">
          <Card className="overflow-hidden !p-0">
            <div
              ref={cam.frameRef}
              className="relative aspect-square w-full overflow-hidden bg-surface-2 sm:aspect-[4/3] lg:aspect-auto lg:h-[clamp(380px,calc(100dvh-380px),700px)]"
            >
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                ref={cam.videoRef}
                autoPlay
                playsInline
                muted
                className={['absolute inset-0 h-full w-full object-cover', live ? '' : 'invisible', cam.mirrored ? '-scale-x-100' : ''].join(' ')}
              />
              {live && !busy && phase === 'idle' && <FaceReadyFrame ready={faceReady} />}

              {cam.status === 'requesting' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-ink-soft">
                  <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary border-t-transparent" />
                  <p className="m-0 text-sm font-medium">Starting camera…</p>
                </div>
              )}

              {cam.status === 'error' && cam.error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
                  <AlertTriangleIcon size={32} className="text-warning" />
                  <h2 className="m-0 text-lg">{cam.error.title}</h2>
                  <p className="m-0 max-w-sm text-sm text-ink-soft">{cam.error.message} You can still check people in with Manual Search & Approve.</p>
                  <Button variant="secondary" onClick={cam.retry}>
                    <RefreshIcon size={16} /> Try Again
                  </Button>
                </div>
              )}

              {/* Top: the verified banner, or the live face-positioning hint. Right padding clears the camera switch. */}
              <div className="pointer-events-none absolute inset-x-0 top-0 p-3 pr-16">
                {banner ? (
                  <div role="status" className="mx-auto flex max-w-full items-center justify-center gap-2 rounded-s bg-success px-4 py-3 text-center text-[15px] font-bold text-white shadow-lg">
                    <CheckIcon size={20} className="shrink-0" strokeWidth={3} />
                    <span className="min-w-0 truncate">{banner.text}</span>
                    {banner.tag && <span className="shrink-0 rounded-full bg-white/25 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide">{banner.tag}</span>}
                  </div>
                ) : (
                  live && phase === 'idle' && <FaceGuidanceBanner detector={face.detector} guidance={face.guidance} pulse={nudge} />
                )}
              </div>

              {live && (
                <div className="absolute right-3 top-3">
                  <IconButton label="Switch camera" tooltip="Switch camera" onClick={cam.flip} className="shadow-lg">
                    <RefreshIcon size={16} />
                  </IconButton>
                </div>
              )}

              {phase === 'comparing' && (
                <div role="status" className="absolute inset-0 flex items-center justify-center bg-black/30 p-4 backdrop-blur-[2px]">
                  <div className="flex max-w-full items-center gap-3 rounded-m border border-line bg-surface px-5 py-3.5 text-sm font-semibold text-ink shadow-lg">
                    <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    Comparing face against registered database…
                  </div>
                </div>
              )}
            </div>

            {/* Result alerts: under the picture, so the camera stays clear */}
            {phase === 'failed' && (
              <div role="alert" className="m-4 mb-0 flex flex-col gap-3 rounded-s border border-danger bg-danger-tint p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 gap-3">
                  <AlertTriangleIcon size={20} className="mt-0.5 shrink-0 text-danger" />
                  <div>
                    <div className="text-sm font-bold text-danger">Face Match Failed</div>
                    <p className="m-0 mt-0.5 text-[13px] text-ink-soft">No matching user photo found in database.</p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                  <Button variant="secondary" onClick={scanAndVerify}>
                    <RefreshIcon size={16} /> Scan again
                  </Button>
                  <Button variant="primary" onClick={openManual}>
                    <SearchIcon size={16} /> Try Manual Search & Approve
                  </Button>
                </div>
              </div>
            )}
            {phase === 'unavailable' && (
              <div role="alert" className="m-4 mb-0 flex flex-col gap-3 rounded-s border border-warning bg-warning-soft p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 gap-3">
                  <AlertTriangleIcon size={20} className="mt-0.5 shrink-0 text-warning" />
                  <div>
                    <div className="text-sm font-bold text-warning">Face matching isn’t set up</div>
                    <p className="m-0 mt-0.5 text-[13px] text-ink-soft">Nothing was compared and no one was checked in. Verify the person by their on-file photo instead.</p>
                  </div>
                </div>
                <Button variant="primary" className="shrink-0" onClick={openManual}>
                  <SearchIcon size={16} /> Try Manual Search & Approve
                </Button>
              </div>
            )}

            {/* The explicit action */}
            <div className="flex flex-col items-center gap-3 px-4 py-4">
              <Button variant="primary" className="w-full !px-6 !py-3 text-base shadow-md sm:w-auto" onClick={scanAndVerify} disabled={!live || busy}>
                <CameraIcon size={18} /> Scan & Verify Face
              </Button>
              <p className="m-0 flex items-start gap-2 text-center text-[13px] text-ink-soft">
                <span aria-hidden="true" className={['mt-1.5 h-2 w-2 shrink-0 rounded-full', status.ok ? 'bg-success' : 'bg-warning'].join(' ')} />
                <span className="text-left">{status.text}</span>
              </p>
            </div>
          </Card>
        </div>

        {/* Right column: whoever needs a decision, then recent activity. Stacks under the camera on smaller screens. */}
        <aside className="flex min-w-0 flex-col gap-5">
          {phase === 'review' && reviewEntry && (
            <div>
              <VerificationHud entry={reviewEntry} method="Face Scan" onConfirm={(id, method) => checkIn(reviewEntry, method === 'Manual' ? 'Manual' : 'Face Scan')} />
              <div className="mt-3 flex justify-end">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setReviewEntry(null);
                    setPhase('idle');
                  }}
                >
                  Not this person
                </Button>
              </div>
            </div>
          )}

          <Card>
            <h2 className="m-0 mb-3 text-[13px] text-ink-soft">Check-in activity{roleFilter === 'all' ? '' : ` · ${ROLE_FILTER_LABEL[roleFilter]}`}</h2>
            <div className="mb-4 grid grid-cols-2 gap-3 text-center">
              <div>
                <div className="font-display text-2xl font-bold text-success">{checkedIn.length}</div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Checked in</div>
              </div>
              <div>
                <div className="font-display text-2xl font-bold text-ink-soft">{waiting}</div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Not checked in</div>
              </div>
            </div>
            {checkedIn.length === 0 ? (
              <p className="m-0 text-sm text-ink-faint">No one checked in yet.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {checkedIn.slice(0, 8).map((r) => (
                  <li key={r.id} className="flex items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success-soft text-[12px] font-bold text-success">
                      {initialsOf(r.firstName, r.lastName)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {r.firstName} {r.lastName}
                      </span>
                      <span className="block truncate text-xs text-ink-faint">{r.teamName || '—'}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[12.5px] font-semibold text-success">{formatTime(r.checkedInAt)}</span>
                      <span className="block text-[11px] text-ink-faint">{r.checkedInMethod}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>

      <ManualCheckInDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        roster={scoped}
        scopeLabel={roleFilter === 'all' ? undefined : ROLE_FILTER_LABEL[roleFilter]}
        onConfirm={confirmManual}
      />
    </div>
  );
}
