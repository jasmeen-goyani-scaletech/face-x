'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { assignRole, ensureSession, hasFamilyRole } from '@/lib/api/auth';
import { getSessionUser } from '@/lib/api/session';
import { listEvents, listTeams, resolveInvite } from '@/lib/api/catalog';
import { getConsents, getCurrentConsents, recordConsent } from '@/lib/api/consents';
import { listDocuments, submitDocument } from '@/lib/api/documents';
import { describeError, fieldErrorsOf, hasCode } from '@/lib/api/errors';
import { evaluateReadiness, getPayment, startCheckout } from '@/lib/api/payments';
import {
  createPlayer,
  createRegistration,
  getRegistration,
  listPlayers,
  listRegistrations,
  submitRegistration,
  updatePlayer,
  updateRegistration
} from '@/lib/api/registrations';
import type {
  ApiConsentStatus,
  ApiConsentVersion,
  ApiDocument,
  ApiEvent,
  ApiPaymentSummary,
  ApiPlayer,
  ApiRegistration,
  ApiRegistrationStatus,
  ApiTeam,
  UpdatePlayerInput
} from '@/lib/api/types';
import { calcAge } from '@/lib/age';
import { setPlayerStarted } from '@/lib/activeRole';
import { emptyFile, freshPlayerRegistration, type PlayerRegistration, type PlayerStep, type TeamInvite, type UploadedFile } from '@/lib/types';
import { DOCUMENT_KEYS, DOCUMENT_TYPE_BY_KEY, hasRejectedDocument, toUploadedFile, type PlayerDocumentKey } from './documentMap';
import { uploadPlayerDocument } from './uploads';
import { useAiDocumentCheck } from './useAiDocumentCheck';

const GUARDIAN_CONSENT = 'GUARDIAN_CONSENT';
/** Statuses a family can still be working on from the wizard (payment may be outstanding). */
const IN_PROGRESS: ApiRegistrationStatus[] = ['DRAFT', 'SUBMITTED', 'PAYMENT_PENDING'];

export type WizardPhase = 'loading' | 'ready' | 'error';

export type InviteState =
  | { status: 'none' }
  | { status: 'valid'; invite: TeamInvite; eventId: string; /** The team has no places left for players. */ full: boolean }
  | { status: 'invalid' };

export interface WizardNotice {
  level: 'info' | 'warning' | 'success';
  title: string;
  text: string;
}

export interface WizardOptions {
  /** `?teamId=` and `?inviteCode=` from a coach invite link. */
  teamId: string | null;
  inviteCode: string | null;
  /** `?eventId=` (with an optional `?teamId=` and no invite code) from the tournament's common link: preselects the event and team. */
  eventId?: string | null;
  /** `?registrationId=` opens that registration (used when coming back from payment). */
  registrationId: string | null;
  /** `?new=1` starts another registration instead of resuming one in progress. */
  startNew: boolean;
  /** `?payment=cancelled|failed` shows why the user is back on the payment step. */
  paymentOutcome: string | null;
}

/**
 * What a family has typed but not yet saved to the server (the registration only exists after the guardian step), kept in
 * this tab's sessionStorage so a refresh doesn't lose it. It is NOT the source of truth: it is dropped the moment the
 * server has the registration, it never holds the waiver tick or signature, and it belongs to one account in one tab.
 */
const DRAFT_KEY = 'facex-player-unsaved';
interface UnsavedDraft {
  userId: string;
  eventId: string;
  teamId: string;
  step: 'basic' | 'guardianConsent';
  basic: PlayerRegistration['basic'];
  guardian: Pick<PlayerRegistration['emergency'], 'guardianName' | 'relationship' | 'guardianPhone' | 'guestCount'>;
}
function readUnsavedDraft(userId: string): UnsavedDraft | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as UnsavedDraft;
    return d.userId === userId ? d : null;
  } catch {
    return null;
  }
}
function writeUnsavedDraft(d: UnsavedDraft | null) {
  try {
    if (d) window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Storage blocked: the form just won't survive a refresh.
  }
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** "Dana Rivera Smith" -> first "Dana", last "Rivera Smith". The guardian form has a single full-name field. */
export function splitFullName(full: string): { firstName: string; lastName: string } {
  const [firstName = '', ...rest] = full.trim().split(/\s+/);
  return { firstName, lastName: rest.join(' ') };
}

/** Where a registration the server already knows belongs in the wizard. */
function stepFor(registration: ApiRegistration, consents: ApiConsentStatus | null, needsReplacement = false): PlayerStep {
  // A document staff rejected can only be fixed on the upload step, whatever has happened since (even after payment).
  if (needsReplacement && registration.status !== 'REJECTED' && registration.status !== 'CANCELLED') return 'documents';
  switch (registration.status) {
    case 'DRAFT': {
      const requirement = consents?.requirements.find((r) => r.code === GUARDIAN_CONSENT);
      const guardianDone = registration.guardians.length > 0 && (!requirement?.required || requirement.accepted);
      // An adult has no guardian or consent; their guest count defaults to 0, so go straight to documents.
      const isAdult = registration.guardians.length === 0 && !requirement?.required;
      return guardianDone || isAdult ? 'documents' : 'guardianConsent';
    }
    case 'SUBMITTED':
    case 'PAYMENT_PENDING':
      return 'payment';
    default:
      return 'complete';
  }
}

function formFrom(registration: ApiRegistration, consents: ApiConsentStatus | null, invite: TeamInvite | null, previous: PlayerRegistration): PlayerRegistration {
  const guardian = registration.guardians.find((g) => g.isPrimary) ?? registration.guardians[0];
  const record = consents?.records.find((r) => r.code === GUARDIAN_CONSENT && r.currentVersion);
  const p = registration.player;
  return {
    ...previous,
    id: registration.registrationNumber,
    status: registration.status === 'DRAFT' ? 'draft' : 'submitted',
    createdAt: Date.parse(registration.createdAt),
    completedAt: registration.submittedAt ? Date.parse(registration.submittedAt) : null,
    basic: { firstName: p.firstName, lastName: p.lastName, email: p.email ?? '', phone: p.phone ?? '', dob: p.dateOfBirth },
    emergency: {
      guardianName: guardian ? `${guardian.firstName} ${guardian.lastName}`.trim() : previous.emergency.guardianName,
      relationship: guardian?.relationship ?? previous.emergency.relationship,
      guardianPhone: guardian?.phone ?? previous.emergency.guardianPhone,
      guardianEmail: guardian?.email ?? previous.emergency.guardianEmail,
      guestCount: registration.guestCount
    },
    invite,
    teamId: registration.team?.id ?? previous.teamId,
    consent: {
      ...previous.consent,
      required: guardian !== undefined || previous.consent.required,
      status: record ? 'completed' : 'not_started',
      agree: record !== undefined || previous.consent.agree,
      signedName: record?.signedName ?? previous.consent.signedName,
      completedAt: record ? Date.parse(record.acceptedAt) : null
    },
    payment: { ...previous.payment, amount: registration.fee.amountCents / 100 }
  };
}

type DraftResult = { kind: 'created' | 'adopted'; registration: ApiRegistration; consents: ApiConsentStatus };

export interface PlayerWizard {
  phase: WizardPhase;
  loadError: string | null;
  reload: () => void;

  /** The form the steps edit. Persisted data is mirrored from the server; this is only the in-memory draft. */
  reg: PlayerRegistration;
  setReg: (next: PlayerRegistration | ((prev: PlayerRegistration) => PlayerRegistration)) => void;
  isMinor: boolean;
  step: PlayerStep;
  goTo: (step: PlayerStep) => void;

  events: ApiEvent[];
  eventId: string;
  setEventId: (id: string) => void;
  selectedEvent: ApiEvent | null;
  teams: ApiTeam[];
  invite: InviteState;

  registration: ApiRegistration | null;
  /** Submitted (or later): details can no longer be edited. */
  locked: boolean;
  documents: Record<PlayerDocumentKey, UploadedFile>;
  consentWording: ApiConsentVersion | null;
  consents: ApiConsentStatus | null;
  payment: ApiPaymentSummary | null;
  notice: WizardNotice | null;

  saving: boolean;
  saveError: string | null;
  /** Field-level problems the API reported (keys are API field paths). */
  apiFieldErrors: Record<string, string>;
  clearSaveError: () => void;

  saveBasic: () => Promise<void>;
  saveGuardianConsent: () => Promise<void>;
  uploadDocument: (key: PlayerDocumentKey, file: File | Blob, fileName: string, onProgress: (percent: number) => void) => Promise<void>;
  finishDocuments: () => Promise<void>;
  startPayment: () => Promise<void>;
}

export function usePlayerWizard(options: WizardOptions): PlayerWizard {
  const { user } = useAuth();
  const [phase, setPhase] = useState<WizardPhase>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [reg, setReg] = useState<PlayerRegistration>(() => freshPlayerRegistration(null));
  const [step, setStep] = useState<PlayerStep>('basic');
  const [events, setEvents] = useState<ApiEvent[]>([]);
  const [eventId, setEventId] = useState('');
  const [teams, setTeams] = useState<ApiTeam[]>([]);
  const [invite, setInvite] = useState<InviteState>({ status: 'none' });
  const [registration, setRegistration] = useState<ApiRegistration | null>(null);
  const [apiDocuments, setApiDocuments] = useState<ApiDocument[]>([]);
  const [previews, setPreviews] = useState<Partial<Record<PlayerDocumentKey, string>>>({});
  const [consentWording, setConsentWording] = useState<ApiConsentVersion | null>(null);
  const [consents, setConsents] = useState<ApiConsentStatus | null>(null);
  const [payment, setPayment] = useState<ApiPaymentSummary | null>(null);
  const [notice, setNotice] = useState<WizardNotice | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [apiFieldErrors, setApiFieldErrors] = useState<Record<string, string>>({});

  // Latest values for use inside async handlers without re-creating them on every keystroke.
  const regRef = useRef(reg);
  regRef.current = reg;
  const registrationRef = useRef(registration);
  registrationRef.current = registration;
  const inviteRef = useRef(invite);
  inviteRef.current = invite;
  const previewsRef = useRef(previews);
  previewsRef.current = previews;
  const consentWordingRef = useRef(consentWording);
  consentWordingRef.current = consentWording;

  const age = calcAge(reg.basic.dob);
  const isMinor = age === null || age < 18;
  const locked = registration !== null && registration.status !== 'DRAFT';
  const selectedEvent = events.find((e) => e.id === eventId) ?? null;

  // Browser-local preview URLs are released when the wizard goes away.
  useEffect(
    () => () => {
      Object.values(previewsRef.current).forEach((u) => u && URL.revokeObjectURL(u));
    },
    []
  );

  /** Reads everything the server knows about a registration into state. Returns what it loaded. */
  const hydrate = useCallback(
    async (registrationId: string, opts: { step?: PlayerStep | 'derive' } = {}) => {
      const [reg0, docs, cons] = await Promise.all([getRegistration(registrationId), listDocuments(registrationId), getConsents(registrationId)]);
      // No `.catch`: a failed lookup must not look like "nothing paid" (the server answers for every non-draft player registration).
      const pay = reg0.status === 'DRAFT' ? null : await getPayment(registrationId);
      const inv = inviteRef.current.status === 'valid' && inviteRef.current.invite.teamId === reg0.team?.id ? inviteRef.current.invite : null;
      setRegistration(reg0);
      setApiDocuments(docs.documents);
      setConsents(cons);
      setPayment(pay);
      setEventId(reg0.event.id);
      setReg((prev) => formFrom(reg0, cons, inv, prev));
      setPlayerStarted(true);
      if (opts.step === 'derive') setStep(stepFor(reg0, cons, hasRejectedDocument(docs.documents)));
      else if (opts.step) setStep(opts.step);
      return { registration: reg0, consents: cons };
    },
    []
  );

  // ---------------------------------------------------------------- bootstrap
  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    setLoadError(null);
    // `?new=1` is a fresh start: nothing from the previous registration (in memory or in this tab's saved draft) may carry over,
    // and a submitted registration left in state would keep every field locked.
    const startingFresh = options.startNew && !options.registrationId;
    if (startingFresh) {
      writeUnsavedDraft(null);
      Object.values(previewsRef.current).forEach((u) => u && URL.revokeObjectURL(u));
      setReg(freshPlayerRegistration(null));
      setStep('basic');
      setEventId('');
      setTeams([]);
      setRegistration(null);
      setApiDocuments([]);
      setPreviews({});
      setConsents(null);
      setPayment(null);
      setNotice(null);
      setSaveError(null);
      setApiFieldErrors({});
    }
    (async () => {
      try {
        const [eventList, summaries, wording] = await Promise.all([listEvents(), hasFamilyRole(user) ? listRegistrations() : Promise.resolve([]), getCurrentConsents()]);
        if (cancelled) return;
        setEvents(eventList);
        setConsentWording(wording.find((c) => c.code === GUARDIAN_CONSENT) ?? null);

        let inviteState: InviteState = { status: 'none' };
        if (options.inviteCode) {
          try {
            const resolved = await resolveInvite({ inviteCode: options.inviteCode, teamId: options.teamId ?? undefined });
            inviteState = {
              status: 'valid',
              eventId: resolved.event.id,
              invite: { teamId: resolved.team.id, inviteCode: options.inviteCode, teamName: resolved.team.name, club: resolved.team.club },
              full: resolved.team.full.player
            };
          } catch (e) {
            // A link the API can't even parse (old-style ids like "COACH-101", a truncated code) is just an invalid
            // invite: the family can still register and pick a team. Only real failures (network, 5xx) stop the page.
            if (!hasCode(e, 'INVITE_NOT_FOUND', 'VALIDATION_ERROR')) throw e;
            inviteState = { status: 'invalid' };
          }
        }
        if (cancelled) return;
        setInvite(inviteState);
        inviteRef.current = inviteState;

        const resumable = options.registrationId
          ? summaries.find((s) => s.id === options.registrationId)
          : options.startNew
            ? undefined
            : // Work in progress first; otherwise show the latest registration that is still alive (its final screen, which
              // offers "Start a new registration"). A cancelled or rejected one doesn't block a fresh start.
              (summaries.find((s) => IN_PROGRESS.includes(s.status)) ?? summaries.find((s) => s.status !== 'CANCELLED' && s.status !== 'REJECTED'));

        if (resumable) {
          const loaded = await hydrate(resumable.id, { step: 'derive' });
          if (cancelled) return;
          if (options.paymentOutcome && loaded.registration.status !== 'DRAFT') {
            setStep('payment');
          }
        } else {
          const linked = options.eventId && eventList.some((e) => e.id === options.eventId) ? options.eventId : '';
          const defaultEvent =
            inviteState.status === 'valid' ? inviteState.eventId : linked || (eventList.length === 1 ? eventList[0].id : '');
          setEventId(defaultEvent);
          // The common link names a team without an invite: it is only a preselection the family can change.
          if (inviteState.status !== 'valid' && !options.inviteCode && options.teamId && linked) {
            const chosen = options.teamId;
            setReg((prev) => ({ ...prev, teamId: chosen }));
          }
          if (inviteState.status === 'valid') {
            const invited = inviteState.invite;
            setReg((prev) => ({ ...prev, invite: invited, teamId: invited.teamId }));
          }
          const draft = user && !startingFresh ? readUnsavedDraft(user.id) : null;
          if (draft) {
            const eventStillOpen = eventList.some((e) => e.id === draft.eventId);
            if (inviteState.status !== 'valid' && eventStillOpen) setEventId(draft.eventId);
            setReg((prev) => ({
              ...prev,
              basic: draft.basic,
              emergency: { ...prev.emergency, ...draft.guardian },
              teamId: inviteState.status === 'valid' ? prev.teamId : draft.teamId
            }));
            // Only continue on the guardian step if the details it depends on are there.
            setStep(draft.step === 'guardianConsent' && draft.basic.dob ? 'guardianConsent' : 'basic');
          }
        }
        setPhase('ready');
      } catch (e) {
        if (cancelled) return;
        setLoadError(describeError(e, 'We couldn’t load your registration. Please try again.'));
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
    // The options come from the URL; reloadKey retries after a failure, and moving to or from `?new=1` (a same-page navigation
    // that keeps this hook mounted) starts the load again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, options.startNew, options.registrationId]);

  // Keep the unsent form across a refresh until the server has the registration.
  useEffect(() => {
    if (phase !== 'ready' || !user) return;
    if (registration) {
      writeUnsavedDraft(null);
      return;
    }
    if (step !== 'basic' && step !== 'guardianConsent') return;
    writeUnsavedDraft({
      userId: user.id,
      eventId,
      teamId: reg.invite ? '' : reg.teamId,
      step,
      basic: reg.basic,
      guardian: {
        guardianName: reg.emergency.guardianName,
        relationship: reg.emergency.relationship,
        guardianPhone: reg.emergency.guardianPhone,
        guestCount: reg.emergency.guestCount
      }
    });
  }, [phase, user, registration, step, eventId, reg.invite, reg.teamId, reg.basic, reg.emergency]);

  // Teams of the chosen event (the picker, and the label of an invite-assigned team).
  useEffect(() => {
    if (!eventId) {
      setTeams([]);
      return;
    }
    let cancelled = false;
    listTeams(eventId)
      .then((list) => !cancelled && setTeams(list))
      .catch(() => !cancelled && setTeams([]));
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  // A payment notice for someone sent back from the payment page.
  useEffect(() => {
    if (phase !== 'ready' || !options.paymentOutcome) return;
    if (options.paymentOutcome === 'cancelled') {
      setNotice({ level: 'warning', title: 'Payment cancelled', text: 'You left the payment page before finishing, so nothing was charged. Continue when you’re ready.' });
    } else if (options.paymentOutcome === 'failed') {
      setNotice({ level: 'warning', title: 'Payment unsuccessful', text: 'Your payment didn’t go through and you haven’t been charged. You can try again.' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ---------------------------------------------------------------- helpers
  // Set synchronously (state would only show up after the next render), so a double-click is ignored, not run twice.
  const inFlight = useRef(false);
  const run = useCallback(async (fn: () => Promise<void>): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setSaving(true);
    setSaveError(null);
    setApiFieldErrors({});
    try {
      await fn();
      return true;
    } catch (e) {
      setSaveError(describeError(e));
      setApiFieldErrors(fieldErrorsOf(e));
      return false;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, []);

  /**
   * The first save of a visitor with no session: the contact email the form collected (the parent's for a minor, the
   * player's own otherwise) starts a guest session, so the rest of the flow is an ordinary signed-in one.
   */
  const ensureRole = useCallback(async (role: 'PARENT' | 'PLAYER') => {
    const form = regRef.current;
    const minor = role === 'PARENT';
    await ensureSession({
      email: minor ? form.emergency.guardianEmail : form.basic.email,
      fullName: minor ? form.emergency.guardianName : `${form.basic.firstName} ${form.basic.lastName}`,
      role
    });
    // Read the live session, not the render's `user`: it may have only just been created.
    if (!getSessionUser()?.roles.includes(role)) await assignRole(role);
  }, []);

  /** Reuses a player this account already created with the same name and birth date (an interrupted earlier attempt), else creates one. */
  const findOrCreatePlayer = useCallback(async (): Promise<ApiPlayer> => {
    const form = regRef.current;
    const b = form.basic;
    const mine = await listPlayers();
    const match = mine.find((p) => sameText(p.firstName, b.firstName) && sameText(p.lastName, b.lastName) && p.dateOfBirth === b.dob);
    if (match) return match;

    const common = { firstName: b.firstName.trim(), lastName: b.lastName.trim(), dateOfBirth: b.dob, email: b.email.trim() || undefined, phone: b.phone.trim() || undefined };
    if (!isMinorNow(b.dob)) return createPlayer({ ...common, forSelf: true });
    const g = form.emergency;
    const name = splitFullName(g.guardianName);
    return createPlayer({
      ...common,
      guardian: { relationship: g.relationship.trim(), firstName: name.firstName, lastName: name.lastName, phone: g.guardianPhone.trim() || undefined }
    });
  }, []);

  /**
   * Creates the registration for this player and event, or picks up the one that already exists (the duplicate check).
   *  - 'created': a brand-new DRAFT; the caller carries on with the next step.
   *  - 'adopted': a registration already existed. It is loaded and the wizard has moved to the step it belongs to
   *    (or shows why the player can't register again), so the caller must stop.
   */
  const createDraft = useCallback(async (): Promise<DraftResult> => {
    const form = regRef.current;
    const chosenEvent = eventId;
    await ensureRole(isMinorNow(form.basic.dob) ? 'PARENT' : 'PLAYER');
    const player = await findOrCreatePlayer();

    const adopt = async (existingId: string, status: ApiRegistrationStatus): Promise<DraftResult> => {
      const loaded = await hydrate(existingId, { step: 'derive' });
      if (status === 'DRAFT') {
        setNotice({ level: 'info', title: 'We found your saved registration', text: 'This player already has a registration in progress for this event, so we’re continuing it.' });
      } else if (IN_PROGRESS.includes(status)) {
        setNotice({ level: 'info', title: 'Registration already submitted', text: 'This player’s registration is already submitted. Payment is the next step.' });
      } else {
        setNotice({ level: 'warning', title: 'Already registered', text: `This player is already registered for this event (${loaded.registration.registrationNumber}).` });
      }
      return { kind: 'adopted', ...loaded };
    };

    const existing = await listRegistrations({ eventId: chosenEvent, playerId: player.id });
    if (existing.length > 0) return adopt(existing[0].id, existing[0].status);

    try {
      const created = await createRegistration({
        eventId: chosenEvent,
        playerId: player.id,
        teamId: form.teamId || undefined,
        guestCount: form.emergency.guestCount ?? 0
      });
      const loaded = await hydrate(created.id);
      return { kind: 'created', ...loaded };
    } catch (e) {
      if (hasCode(e, 'REGISTRATION_ALREADY_EXISTS')) {
        // Lost a race with another tab or an earlier attempt: the registration exists now.
        const again = await listRegistrations({ eventId: chosenEvent, playerId: player.id });
        if (again.length > 0) return adopt(again[0].id, again[0].status);
      }
      throw e;
    }
  }, [eventId, ensureRole, findOrCreatePlayer, hydrate]);

  const goTo = useCallback((next: PlayerStep) => {
    setStep(next);
    window.scrollTo(0, 0);
  }, []);

  // ---------------------------------------------------------------- step 1: basic info
  const saveBasic = useCallback(async () => {
    await run(async () => {
      if (!eventId) throw new Error('no event');
      const current = registrationRef.current;
      const form = regRef.current;
      if (current) {
        if (current.status === 'DRAFT') {
          const b = form.basic;
          const patch: UpdatePlayerInput = {};
          if (b.firstName.trim() !== current.player.firstName) patch.firstName = b.firstName.trim();
          if (b.lastName.trim() !== current.player.lastName) patch.lastName = b.lastName.trim();
          if (b.dob !== current.player.dateOfBirth) patch.dateOfBirth = b.dob;
          if ((b.email.trim() || null) !== current.player.email) patch.email = b.email.trim() || null;
          if ((b.phone.trim() || null) !== current.player.phone) patch.phone = b.phone.trim() || null;
          if (Object.keys(patch).length > 0) await updatePlayer(current.player.id, patch);
          if (form.teamId && form.teamId !== current.team?.id) await updateRegistration(current.id, { teamId: form.teamId });
          await hydrate(current.id);
        }
        goTo('guardianConsent');
        return;
      }
      // An adult has no guardian step to wait for, so their draft is created now. A minor's is created once the
      // guardian is known (the API needs it to create the player).
      if (!isMinorNow(form.basic.dob)) {
        const draft = await createDraft();
        if (draft.kind === 'adopted') return;
      }
      goTo('guardianConsent');
    });
  }, [run, eventId, hydrate, createDraft, goTo]);

  // ---------------------------------------------------------------- step 2: guardian & consent
  const saveGuardianConsent = useCallback(async () => {
    await run(async () => {
      const form = regRef.current;
      let current = registrationRef.current;
      let fresh: { registration: ApiRegistration; consents: ApiConsentStatus };

      if (!current) {
        const draft = await createDraft();
        // An existing registration was adopted: its own state decides the step.
        if (draft.kind === 'adopted') return;
        current = draft.registration;
        fresh = draft;
      } else {
        if (current.status === 'DRAFT' && (form.emergency.guestCount ?? 0) !== current.guestCount) {
          await updateRegistration(current.id, { guestCount: form.emergency.guestCount ?? 0 });
        }
        fresh = await hydrate(current.id);
      }
      const registrationId = current.id;
      const requirement = fresh.consents.requirements.find((r) => r.code === GUARDIAN_CONSENT);
      if (requirement?.required && !requirement.accepted) {
        const shown = consentWordingRef.current;
        if (!requirement.current) throw new Error('consent not published');
        if (!shown || requirement.current.id !== shown.id) {
          // The wording changed since it was shown: the family must read and accept the current text.
          setConsentWording(requirement.current);
          setReg((prev) => ({ ...prev, consent: { ...prev.consent, agree: false } }));
          setSaveError('The consent wording was just updated. Please read it again and accept to continue.');
          return;
        }
        await recordConsent(registrationId, { consentId: shown.id, signedName: form.consent.signedName.trim(), accepted: true });
        await hydrate(registrationId);
      }

      goTo('documents');
    });
  }, [run, createDraft, hydrate, goTo]);

  // ---------------------------------------------------------------- step 3: photo & documents
  const aiCheck = useAiDocumentCheck();
  // A document an admin rejected is replaced without another AI check: remember which types those are whenever the list is loaded.
  const { noteRejected } = aiCheck;
  useEffect(() => noteRejected(apiDocuments), [apiDocuments, noteRejected]);
  const documents = useMemo(() => {
    const out = {} as Record<PlayerDocumentKey, UploadedFile>;
    for (const key of DOCUMENT_KEYS) {
      // A document the AI check turned down the first time is held back until the person replaces it.
      out[key] = aiCheck.blocked.has(DOCUMENT_TYPE_BY_KEY[key])
        ? emptyFile()
        : toUploadedFile(
            apiDocuments.find((d) => d.documentType === DOCUMENT_TYPE_BY_KEY[key]),
            previews[key]
          );
    }
    return out;
  }, [apiDocuments, previews, aiCheck.blocked]);

  const uploadDocument = useCallback(async (key: PlayerDocumentKey, file: File | Blob, fileName: string, onProgress: (percent: number) => void) => {
    const current = registrationRef.current;
    if (!current) throw new Error('Finish the earlier steps before uploading documents.');
    let document: ApiDocument;
    try {
      document = await uploadPlayerDocument(current.id, key, file, fileName, onProgress);
    } catch (e) {
      throw new Error(describeError(e, 'We couldn’t upload that file. Please try again.'));
    }
    const url = URL.createObjectURL(file);
    setPreviews((prev) => {
      const old = prev[key];
      if (old) URL.revokeObjectURL(old);
      return { ...prev, [key]: url };
    });
    setApiDocuments((prev) => [...prev.filter((d) => d.documentType !== document.documentType), document]);
    // The photo is saved either way; if it can't become a face for check-in, say how to fix it.
    if (document.faceEnrollment?.outcome === 'FAILED' && document.faceEnrollment.problem) {
      const why: Record<string, string> = {
        NO_FACE_DETECTED: 'We couldn’t find a face in that photo. Face the camera in good light and take it again.',
        MULTIPLE_FACES: 'More than one face is in that photo. Please upload a photo of the player alone.',
        LOW_QUALITY: 'The face in that photo is too small or unclear. Move closer, use good light and take it again.',
        IMAGE_REJECTED: 'That photo can’t be used for face check-in. Please take a clearer one.'
      };
      setNotice({ level: 'warning', title: 'Please retake the photo', text: why[document.faceEnrollment.problem] ?? why.IMAGE_REJECTED });
    } else if (document.documentType === 'PROFILE_PHOTO') {
      setNotice(null);
    }
    // The first AI rejection is shown (and the upload row asks for a replacement); a second one is silent.
    const rejection = await aiCheck.review(document);
    if (rejection) throw new Error(rejection);
    // A file that replaces one an admin rejected goes to staff review right away, so the admin sees it without a second step.
    // If this call fails the upload still stands and "Submit" sends it later, so the failure is not shown as an upload error.
    if (aiCheck.replacesRejected(document.documentType)) {
      const sent = await submitDocument(document.id).catch(() => null);
      if (sent) setApiDocuments((prev) => [...prev.filter((d) => d.documentType !== sent.documentType), sent]);
    }
  }, [aiCheck]);

  const finishDocuments = useCallback(async () => {
    await run(async () => {
      const current = registrationRef.current;
      if (!current) throw new Error('no registration');
      const docs = await listDocuments(current.id);
      // Everything stored and checked goes to staff review; rejected ones were replaced by a new upload.
      for (const d of docs.documents) if (d.state === 'UPLOADED') await submitDocument(d.id, { aiRejected: aiCheck.aiRejected(d.documentType) });
      if (current.status === 'DRAFT') await submitRegistration(current.id);
      const loaded = await hydrate(current.id);
      // (Everything rejected has just been replaced, so nothing sends the family back to this step.)
      goTo(stepFor(loaded.registration, loaded.consents) === 'complete' ? 'complete' : 'payment');
    });
  }, [run, hydrate, goTo, aiCheck]);

  // ---------------------------------------------------------------- step 4: payment
  const startPayment = useCallback(async () => {
    await run(async () => {
      const current = registrationRef.current;
      if (!current) throw new Error('no registration');
      if (current.fee.amountCents === 0) {
        // Nothing to pay: ask the server to move the registration along.
        await evaluateReadiness(current.id);
        await hydrate(current.id);
        goTo('complete');
        return;
      }
      const checkout = await startCheckout(current.id);
      // Hand over to Stripe's hosted page. The registration is already saved on the server, so nothing is lost.
      window.location.assign(checkout.checkoutUrl);
    });
  }, [run, hydrate, goTo]);

  return {
    phase,
    loadError,
    reload: () => setReloadKey((k) => k + 1),
    reg,
    setReg,
    isMinor,
    step,
    goTo,
    events,
    eventId,
    setEventId,
    selectedEvent,
    teams,
    invite,
    registration,
    locked,
    documents,
    consentWording,
    consents,
    payment,
    notice,
    saving,
    saveError,
    apiFieldErrors,
    clearSaveError: () => setSaveError(null),
    saveBasic,
    saveGuardianConsent,
    uploadDocument,
    finishDocuments,
    startPayment
  };
}

/** Same under-18 test as the form uses (an unknown birth date counts as a minor). */
function isMinorNow(dob: string): boolean {
  const age = calcAge(dob);
  return age === null || age < 18;
}
