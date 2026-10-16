'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { assignRole, ensureSession } from '@/lib/api/auth';
import { getSessionUser } from '@/lib/api/session';
import { listEvents, resolveInvite } from '@/lib/api/catalog';
import { getConsents, getCurrentConsents, recordConsent } from '@/lib/api/consents';
import { listDocuments, submitDocument } from '@/lib/api/documents';
import { describeError, fieldErrorsOf, hasCode, isApiError } from '@/lib/api/errors';
import { evaluateReadiness } from '@/lib/api/payments';
import {
  createPersonnelRegistration,
  getPersonnelRegistration,
  listPersonnelRegistrations,
  submitPersonnelRegistration,
  updatePersonnelRegistration
} from '@/lib/api/registrations';
import { createStaffProfile, listStaffProfiles, updateStaffProfile } from '@/lib/api/staff';
import type {
  ApiConsentStatus,
  ApiConsentVersion,
  ApiDocument,
  ApiEvent,
  ApiPersonnelRegistration,
  ApiStaffProfile
} from '@/lib/api/types';
import { useLocalStorage } from '@/lib/storage';
import { emptyFile, type CoachRegistration, type StaffRegistration, type TeamInvite, type UploadedFile } from '@/lib/types';
import { newestFileOfType, newestPerType, toUploadedFile } from './documentMap';
import {
  AB506_CONSENT,
  CLOSED,
  COACH_CONFIG,
  STAFF_CONFIG,
  emptyFiles,
  viewOf,
  type CoachDocKey,
  type PersonnelKindConfig,
  type StaffDocKey
} from './personnel';
import { uploadRegistrationDocument } from './uploads';
import { useAiDocumentCheck } from './useAiDocumentCheck';

export type PersonnelPhase = 'loading' | 'ready' | 'error';
export type PersonnelStep = 'basic' | 'certificates' | 'status';

export type PersonnelInviteState = { status: 'none' } | { status: 'valid'; invite: TeamInvite; eventId: string; /** The team has no places left for this kind of registrant. */ full: boolean } | { status: 'invalid' };

export interface PersonnelWizardOptions {
  /** `?teamId=` and `?inviteCode=` from a team invite link. */
  teamId: string | null;
  inviteCode: string | null;
  /** `?eventId=` (with an optional `?teamId=`) from the tournament's common link: preselects the event and team. */
  eventId?: string | null;
}

export interface PersonnelWizard<K extends string, R extends CoachRegistration | StaffRegistration> {
  phase: PersonnelPhase;
  loadError: string | null;
  reload: () => void;

  /** The browser-side copy of the registration: the form being filled in, refreshed from the server after every step. */
  reg: R;
  setReg: (next: R | ((prev: R) => R)) => void;
  step: PersonnelStep;
  goTo: (step: PersonnelStep) => void;

  events: ApiEvent[];
  eventId: string;
  setEventId: (id: string) => void;
  invite: PersonnelInviteState;

  registration: ApiPersonnelRegistration | null;
  /** Submitted (or later): details can no longer be edited. */
  locked: boolean;
  /** An admin turned the whole registration down: nothing more can be uploaded. */
  closed: boolean;
  /** What the server holds for each document (with a preview for files added in this visit). */
  files: Record<K, UploadedFile>;

  saving: boolean;
  saveError: string | null;
  /** Field-level problems the API reported (keys are API field paths). */
  apiFieldErrors: Record<string, string>;
  photoBusy: boolean;
  photoError: string | null;

  /** Saves the person's details and creates the draft registration. Resolves true when the next step can open. */
  saveBasic: () => Promise<boolean>;
  /** Stores a file for real: resolves when the server has checked it, throws an Error fit to show if it fails. */
  uploadDocument: (key: K, file: File | Blob, fileName: string, onProgress: (percent: number) => void) => Promise<void>;
  /** The camera capture for the live photo. */
  captureLivePhoto: (dataUrl: string) => Promise<void>;
  /** Records the AB 506 acknowledgement (coach), sends the documents for review and submits the registration. */
  submitAll: () => Promise<boolean>;
}

const IN_FLIGHT_ALIVE = (status: string) => !CLOSED.includes(status);

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The whole coach / staff registration against the API, shared by both pages (they differ only in `config`):
 *   details -> profile + draft registration, photo & certificates -> real uploads, submit -> consent, document review, registration.
 * The server is the source of truth. The browser copy in localStorage (config.storageKey) is kept in step so the parts of
 * the app that read it keep working.
 */
function usePersonnelWizardFor<K extends string, R extends CoachRegistration | StaffRegistration>(
  config: PersonnelKindConfig<K, R>,
  options: PersonnelWizardOptions
): PersonnelWizard<K, R> {
  const { user } = useAuth();
  const [reg, setReg, hydrated] = useLocalStorage<R>(config.storageKey, config.fresh(null));

  const [phase, setPhase] = useState<PersonnelPhase>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [step, setStep] = useState<PersonnelStep>('basic');
  const [events, setEvents] = useState<ApiEvent[]>([]);
  const [eventId, setEventId] = useState('');
  const [invite, setInvite] = useState<PersonnelInviteState>({ status: 'none' });
  const [profile, setProfile] = useState<ApiStaffProfile | null>(null);
  const [registration, setRegistration] = useState<ApiPersonnelRegistration | null>(null);
  const [apiDocuments, setApiDocuments] = useState<ApiDocument[]>([]);
  const [consents, setConsents] = useState<ApiConsentStatus | null>(null);
  const [wording, setWording] = useState<ApiConsentVersion | null>(null);
  const [previews, setPreviews] = useState<Partial<Record<K, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [apiFieldErrors, setApiFieldErrors] = useState<Record<string, string>>({});
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // Latest values for async handlers, without re-creating them on every keystroke.
  const regRef = useRef(reg);
  regRef.current = reg;
  const registrationRef = useRef(registration);
  registrationRef.current = registration;
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const inviteRef = useRef(invite);
  inviteRef.current = invite;
  const eventIdRef = useRef(eventId);
  eventIdRef.current = eventId;
  const previewsRef = useRef(previews);
  previewsRef.current = previews;
  const consentsRef = useRef(consents);
  consentsRef.current = consents;
  const wordingRef = useRef(wording);
  wordingRef.current = wording;

  const keys = useMemo(() => Object.keys(config.documentTypes) as K[], [config]);
  const locked = registration !== null && registration.status !== 'DRAFT';
  const closed = registration !== null && CLOSED.includes(registration.status);

  // Browser-local preview URLs are released when the wizard goes away.
  useEffect(
    () => () => {
      Object.values<string | undefined>(previewsRef.current).forEach((u) => u && URL.revokeObjectURL(u));
    },
    []
  );

  // ---------------------------------------------------------------- documents as the form shows them
  const aiCheck = useAiDocumentCheck();
  // A document an admin rejected is replaced without another AI check: remember which types those are whenever the list is loaded.
  const { noteRejected } = aiCheck;
  useEffect(() => noteRejected(apiDocuments), [apiDocuments, noteRejected]);
  const files = useMemo(() => {
    const out = {} as Record<K, UploadedFile>;
    for (const key of keys) {
      // A document the AI check turned down the first time is held back until the person replaces it.
      out[key] = aiCheck.blocked.has(config.documentTypes[key]) ? emptyFile() : newestFileOfType(apiDocuments, config.documentTypes[key], previews[key]);
    }
    return out;
  }, [apiDocuments, previews, keys, config, aiCheck.blocked]);

  // What the server decides, written into the browser copy. Computed on every render so the screen never shows a stale copy
  // from an earlier visit while the effect below persists it (no previews: they cannot outlive the page).
  const mirrorInput = useMemo(() => {
    if (!registration) return null;
    const newest = newestPerType(apiDocuments);
    const stored = emptyFiles(keys);
    for (const key of keys) stored[key] = toUploadedFile(newest.find((d) => d.documentType === config.documentTypes[key]));
    const inv = invite.status === 'valid' && invite.invite.teamId === registration.team?.id ? invite.invite : null;
    return { registration, profile, files: stored, invite: inv, consents, view: viewOf(registration, apiDocuments) };
  }, [registration, profile, apiDocuments, invite, consents, keys, config]);

  const shownReg = useMemo(() => (mirrorInput ? config.mirror(reg, mirrorInput) : reg), [reg, mirrorInput, config]);

  useEffect(() => {
    if (mirrorInput) setReg((prev) => config.mirror(prev, mirrorInput));
  }, [mirrorInput, config, setReg]);

  /** Reads everything the server knows about the registration into state. */
  const hydrate = useCallback(async (registrationId: string) => {
    const [registration0, docs, cons] = await Promise.all([getPersonnelRegistration(registrationId), listDocuments(registrationId), getConsents(registrationId)]);
    setRegistration(registration0);
    setReg((prev) => config.fromRegistration(prev, registration0));
    setApiDocuments(docs.documents);
    setConsents(cons);
    setEventId(registration0.event.id);
    return { registration: registration0, documents: docs.documents, consents: cons };
  }, [config, setReg]);

  // ---------------------------------------------------------------- bootstrap
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    setPhase('loading');
    setLoadError(null);
    (async () => {
      try {
        // A new account has no role yet, so the API answers 403 INSUFFICIENT_ROLE: it simply has nothing yet.
        const orNone = <T,>(p: Promise<T[]>): Promise<T[]> =>
          p.catch((e: unknown) => {
            if (hasCode(e, 'INSUFFICIENT_ROLE')) return [];
            throw e;
          });
        // A visitor with no session yet has nothing saved, and the protected lists are not even asked for.
        const [eventList, profiles, summaries, current] = await Promise.all([
          listEvents(),
          user ? orNone(listStaffProfiles()) : Promise.resolve([] as ApiStaffProfile[]),
          user ? orNone(listPersonnelRegistrations(config.kind)) : Promise.resolve([] as Awaited<ReturnType<typeof listPersonnelRegistrations>>),
          getCurrentConsents()
        ]);
        if (cancelled) return;
        const open = eventList.filter((e) => e.registrationOpen);
        setEvents(open);
        setWording(current.find((c) => c.code === AB506_CONSENT) ?? null);
        const mine = profiles.find((p) => p.profileType === config.kind) ?? null;
        setProfile(mine);
        profileRef.current = mine;

        let inviteState: PersonnelInviteState = { status: 'none' };
        if (options.inviteCode) {
          try {
            const resolved = await resolveInvite({ inviteCode: options.inviteCode, teamId: options.teamId ?? undefined });
            inviteState = {
              status: 'valid',
              eventId: resolved.event.id,
              invite: { teamId: resolved.team.id, inviteCode: options.inviteCode, teamName: resolved.team.name, club: resolved.team.club },
              full: config.kind === 'COACH' ? resolved.team.full.coach : resolved.team.full.staff
            };
          } catch (e) {
            // A link the API can't parse or find is just an invalid invite: the person can still register without a team.
            if (!hasCode(e, 'INVITE_NOT_FOUND', 'VALIDATION_ERROR')) throw e;
            inviteState = { status: 'invalid' };
          }
        }
        if (cancelled) return;
        setInvite(inviteState);
        inviteRef.current = inviteState;

        const existing = summaries.find((s) => IN_FLIGHT_ALIVE(s.status)) ?? summaries[0];
        if (existing) {
          const loaded = await hydrate(existing.id);
          if (cancelled) return;
          setStep(loaded.registration.status === 'DRAFT' ? 'certificates' : 'status');
        } else {
          // Nothing on the server: whatever a previous visit (or another account on this browser) left in the browser copy
          // as "submitted" is not real. A half-typed form is kept.
          const invited = inviteState.status === 'valid' ? inviteState.invite : null;
          const linked = options.eventId && open.some((e) => e.id === options.eventId) ? options.eventId : '';
          setEventId(inviteState.status === 'valid' ? inviteState.eventId : linked || (open.length === 1 ? open[0].id : ''));
          setReg((prev) => {
            const base = prev.status === 'submitted' ? config.fresh(invited) : { ...prev, status: 'not_started' as const, invite: invited ?? prev.invite };
            const withProfile = mine ? config.fromProfile(base as R, mine) : (base as R);
            return withProfile.basic.email || !user ? withProfile : ({ ...withProfile, basic: { ...withProfile.basic, email: user.email } } as R);
          });
          setStep('basic');
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
    // The options come from the URL and don't change during a visit; reloadKey retries after a failure. Not `user`: a
    // guest session starting on the first save must not reload the wizard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, reloadKey]);

  const goTo = useCallback((next: PersonnelStep) => {
    setStep(next);
    window.scrollTo(0, 0);
  }, []);

  // Set synchronously (state would only show up after the next render), so a double-click is ignored, not run twice.
  const inFlight = useRef(false);
  const run = useCallback(async (fn: () => Promise<boolean>): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setSaving(true);
    setSaveError(null);
    setApiFieldErrors({});
    try {
      return await fn();
    } catch (e) {
      // An API failure has friendly wording of its own; a plain Error here is one of this hook's own messages, already fit to show.
      setSaveError(isApiError(e) ? describeError(e) : e instanceof Error ? e.message : describeError(e));
      setApiFieldErrors(fieldErrorsOf(e));
      return false;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, []);

  // ---------------------------------------------------------------- step 1: details
  const saveBasic = useCallback(
    () =>
      run(async () => {
        const form = regRef.current;
        const current = registrationRef.current;
        // Once submitted the details are what the documents were checked against: just show where things stand.
        if (current && current.status !== 'DRAFT') {
          goTo('status');
          return true;
        }
        const chosenEvent = eventIdRef.current;
        if (!current && !chosenEvent) throw new Error('Choose the event you are registering for.');

        const b = form.basic;
        // No session yet: the email typed on this form starts a guest session before anything is saved.
        await ensureSession({ email: b.email, fullName: `${b.firstName} ${b.lastName}`, role: config.kind });
        // The live session, not the render's `user`, which may have only just been created.
        if (!getSessionUser()?.roles.includes(config.kind)) await assignRole(config.kind);


        const staffRole = config.staffRole(form);
        const fields = { firstName: b.firstName.trim(), lastName: b.lastName.trim(), email: b.email.trim(), phone: b.phone.trim() || undefined };
        let person = profileRef.current;
        if (!person) {
          person = await createStaffProfile({ profileType: config.kind, staffRole, ...fields });
        } else if (
          !sameText(person.firstName, fields.firstName) ||
          !sameText(person.lastName, fields.lastName) ||
          !sameText(person.email, fields.email) ||
          (person.phone ?? '') !== (fields.phone ?? '') ||
          (staffRole !== undefined && person.staffRole !== staffRole)
        ) {
          person = await updateStaffProfile(person.id, { ...fields, phone: fields.phone ?? null, staffRole });
        }
        setProfile(person);
        profileRef.current = person;

        // A team comes from a valid invite, or from the common link's preselection (which has no invite code).
        const invitedTeam =
          inviteRef.current.status === 'valid' ? inviteRef.current.invite.teamId : !options.inviteCode ? (options.teamId ?? undefined) : undefined;
        if (current) {
          if (invitedTeam && invitedTeam !== current.team?.id) await updatePersonnelRegistration(current.id, { teamId: invitedTeam });
          await hydrate(current.id);
        } else {
          try {
            const created = await createPersonnelRegistration({ eventId: chosenEvent, staffProfileId: person.id, teamId: invitedTeam });
            await hydrate(created.id);
          } catch (e) {
            if (!hasCode(e, 'REGISTRATION_ALREADY_EXISTS')) throw e;
            // Lost a race with another tab or an interrupted earlier attempt: carry on with the one that exists.
            const again = await listPersonnelRegistrations(config.kind, { eventId: chosenEvent, staffProfileId: person.id });
            if (again.length === 0) throw e;
            await hydrate(again[0].id);
          }
        }
        goTo('certificates');
        return true;
      }),
    [run, config, hydrate, goTo, options.inviteCode, options.teamId]
  );

  // ---------------------------------------------------------------- step 2: photo & documents
  const uploadDocument = useCallback(
    async (key: K, file: File | Blob, fileName: string, onProgress: (percent: number) => void) => {
      const current = registrationRef.current;
      if (!current) throw new Error('Save your details first, then upload your documents.');
      let document: ApiDocument;
      try {
        document = await uploadRegistrationDocument(current.id, config.documentTypes[key], file, fileName, onProgress);
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
      // The first AI rejection is shown (and the upload row asks for a replacement); a second one is silent.
      const rejection = await aiCheck.review(document);
      if (rejection) throw new Error(rejection);
      // A file that replaces one an admin rejected goes to staff review right away, so the admin sees it without a second step.
      // If this call fails the upload still stands and "Submit" sends it later, so the failure is not shown as an upload error.
      if (aiCheck.replacesRejected(document.documentType)) {
        const sent = await submitDocument(document.id).catch(() => null);
        if (sent) setApiDocuments((prev) => [...prev.filter((d) => d.documentType !== sent.documentType), sent]);
      }
    },
    [config, aiCheck]
  );

  const captureLivePhoto = useCallback(
    async (dataUrl: string) => {
      setPhotoError(null);
      setPhotoBusy(true);
      try {
        const blob = await (await fetch(dataUrl)).blob();
        await uploadDocument('livePhoto' as K, blob, 'selfie.jpg', () => undefined);
      } catch (e) {
        setPhotoError(e instanceof Error ? e.message : 'We couldn’t upload that photo. Please try again.');
      } finally {
        setPhotoBusy(false);
      }
    },
    [uploadDocument]
  );

  // ---------------------------------------------------------------- step 3: submit
  const submitAll = useCallback(
    () =>
      run(async () => {
        const current = registrationRef.current;
        if (!current) throw new Error('Save your details first.');

        // The coach's AB 506 acknowledgement: recorded against the wording the league has published.
        const needed = consentsRef.current?.requirements.find((r) => r.code === AB506_CONSENT);
        if (needed?.required && !needed.accepted) {
          const published = needed.current ?? wordingRef.current;
          if (!published) throw new Error('The AB 506 acknowledgement can’t be recorded yet because its wording hasn’t been published. Please try again later.');
          const b = regRef.current.basic;
          await recordConsent(current.id, { consentId: published.id, signedName: `${b.firstName} ${b.lastName}`.trim(), accepted: true });
        }

        // Everything stored and checked goes to staff review; a rejected document was replaced by a new upload.
        const docs = await listDocuments(current.id);
        for (const d of docs.documents) if (d.state === 'UPLOADED') await submitDocument(d.id, { aiRejected: aiCheck.aiRejected(d.documentType) });
        if (current.status === 'DRAFT') await submitPersonnelRegistration(current.id);
        // Moves the registration into review (or further) now that its documents and consent are in.
        await evaluateReadiness(current.id);
        await hydrate(current.id);
        goTo('status');
        return true;
      }),
    [run, hydrate, goTo, aiCheck]
  );

  return {
    phase,
    loadError,
    reload: () => setReloadKey((k) => k + 1),
    reg: shownReg,
    setReg,
    step,
    goTo,
    events,
    eventId,
    setEventId,
    invite,
    registration,
    locked,
    closed,
    files: hydrated ? files : emptyFiles(keys),
    saving,
    saveError,
    apiFieldErrors,
    photoBusy,
    photoError,
    saveBasic,
    uploadDocument,
    captureLivePhoto,
    submitAll
  };
}

export const useCoachWizard = (options: PersonnelWizardOptions) => usePersonnelWizardFor<CoachDocKey, CoachRegistration>(COACH_CONFIG, options);
export const useStaffWizard = (options: PersonnelWizardOptions) => usePersonnelWizardFor<StaffDocKey, StaffRegistration>(STAFF_CONFIG, options);
