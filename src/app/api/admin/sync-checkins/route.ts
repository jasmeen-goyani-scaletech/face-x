import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * PLACEHOLDER Admin sync endpoint. Face-X has no database yet, so this keeps check-ins in this server process's memory.
 * That is enough to exercise the offline queue end to end (idempotent POST, then GET to reconcile), but it is NOT durable
 * (lost on restart, not shared across serverless instances) and it has NO authentication: the admin passcode is a
 * client-side placeholder. Replace the Map with a real store and put real staff auth in front before using it for real.
 */
interface StoredCheckIn {
  uuid: string;
  personId: string;
  role: string;
  method: string;
  override: boolean;
  checkedInAt: number;
  receivedAt: number;
}

const g = globalThis as unknown as { __facexCheckIns?: Map<string, StoredCheckIn> };
const store = (g.__facexCheckIns ??= new Map<string, StoredCheckIn>());

const ROLES = new Set(['player', 'coach', 'staff']);

export async function POST(request: Request) {
  let body: Partial<StoredCheckIn>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { uuid, personId, role, method, override, checkedInAt } = body;
  if (
    typeof uuid !== 'string' ||
    !uuid ||
    typeof personId !== 'string' ||
    !personId ||
    typeof role !== 'string' ||
    !ROLES.has(role) ||
    typeof method !== 'string' ||
    typeof checkedInAt !== 'number' ||
    !Number.isFinite(checkedInAt)
  ) {
    return NextResponse.json({ error: 'Invalid check-in payload' }, { status: 422 });
  }
  // Idempotent: a retry of an already-recorded uuid is acknowledged, never recorded twice.
  if (!store.has(uuid)) {
    store.set(uuid, { uuid, personId, role, method, override: !!override, checkedInAt, receivedAt: Date.now() });
  }
  return NextResponse.json({ ok: true, uuid });
}

/** The server's current view: one check-in per person (the earliest), for the client to reconcile against. */
export async function GET() {
  const earliest = new Map<string, StoredCheckIn>();
  for (const c of store.values()) {
    const prev = earliest.get(c.personId);
    if (!prev || c.checkedInAt < prev.checkedInAt) earliest.set(c.personId, c);
  }
  return NextResponse.json({ checkIns: [...earliest.values()] }, { headers: { 'Cache-Control': 'no-store' } });
}
