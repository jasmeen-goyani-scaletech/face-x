'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Chip from '@/components/ui/Chip';
import { TextField } from '@/components/ui/Field';
import { PlusIcon, TrophyIcon, ChevronRightIcon } from '@/components/ui/Icons';
import { getDataClient } from '@/lib/data/client';
import type { Tournament } from '@/lib/data/types';
import { formatDate } from '@/lib/format';
import { compact } from '@/lib/validation';
import { useFieldErrors } from '@/lib/useFieldErrors';

const STATUS_KIND: Record<Tournament['status'], 'neutral' | 'success' | 'warning'> = {
  draft: 'neutral',
  published: 'success',
  closed: 'warning'
};

export default function TournamentsPage() {
  const [tournaments, setTournaments] = useState<Tournament[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', date: '', time: '', location: '' });
  // Keys equal the input ids, so Create focuses the first invalid field.
  const { error, blur, submit, reset } = useFieldErrors(
    compact({
      name: form.name.trim() ? null : 'Please enter a tournament name.',
      date: form.date ? null : 'Please choose the tournament date.'
    }),
    ['name', 'date'] as const
  );

  useEffect(() => {
    getDataClient().tournaments.list().then(setTournaments);
  }, []);

  async function create() {
    if (!submit()) return;
    const client = getDataClient();
    await client.tournaments.create({ ...form, status: 'draft' });
    setTournaments(await client.tournaments.list());
    setForm({ name: '', date: '', time: '', location: '' });
    reset();
    setShowCreate(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl mb-1">Tournaments</h1>
          <p className="text-ink-soft text-sm">Create a tournament, then generate registration links for it.</p>
        </div>
        <Button variant="primary" onClick={() => setShowCreate((v) => !v)}>
          <PlusIcon size={16} /> Create Tournament
        </Button>
      </div>

      {showCreate && (
        <Card className="mb-5">
          <h2 className="text-lg mb-4">New Tournament</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            <TextField id="name" label="Tournament Name" value={form.name} error={error('name')} onBlur={blur('name')} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <TextField id="date" label="Date" type="date" value={form.date} error={error('date')} onBlur={blur('date')} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            <TextField id="t-time" label="Time" optional placeholder="5:30 PM – 8:00 PM" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
            <TextField id="t-location" label="Location" optional value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="secondary"
              onClick={() => {
                reset();
                setShowCreate(false);
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" onClick={create}>
              Create
            </Button>
          </div>
        </Card>
      )}

      {tournaments === null && <p className="text-ink-soft text-sm">Loading…</p>}

      {tournaments?.length === 0 && (
        <Card className="text-center py-10">
          <TrophyIcon size={32} className="mx-auto mb-3 text-ink-faint" />
          <p className="text-ink-soft text-sm">No tournaments yet. Create one to generate registration links.</p>
        </Card>
      )}

      <div className="flex flex-col gap-2.5">
        {tournaments?.map((t) => (
          <Link key={t.id} href={`/admin/tournaments/${t.id}`} className="no-underline">
            <Card className="flex items-center justify-between gap-3 hover:border-line-strong">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold text-ink">{t.name}</span>
                  <Chip kind={STATUS_KIND[t.status]}>{t.status}</Chip>
                </div>
                <div className="text-[12.5px] text-ink-soft">
                  {formatDate(t.date)}
                  {t.location ? ` · ${t.location}` : ''}
                </div>
              </div>
              <ChevronRightIcon size={18} className="text-ink-faint shrink-0" />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
