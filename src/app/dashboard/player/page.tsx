'use client';

import Link from 'next/link';
import Topbar from '@/components/layout/Topbar';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { useLocalStorage } from '@/lib/storage';
import { freshPlayerRegistration, type PlayerRegistration } from '@/lib/types';
import { formatDate } from '@/lib/format';
import { EVENT_INFO } from '@/lib/seed';
import { CalendarIcon, ShieldIcon } from '@/components/ui/Icons';

export default function PlayerDashboardPage() {
  const [reg] = useLocalStorage<PlayerRegistration>('facex-player-registration', freshPlayerRegistration(null));

  if (reg.status !== 'submitted') {
    return (
      <main>
        <Topbar eyebrow="Status dashboard" />
        <div className="mx-auto max-w-[900px] px-5 pt-8 pb-16">
          <Card>
            <p className="text-ink-soft mb-4">No submitted player registration yet.</p>
            <Link href="/register/player">
              <Button variant="primary">Go to Registration</Button>
            </Link>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main>
      <Topbar eyebrow={`Registration #${reg.id}`} />
      <div className="mx-auto max-w-[560px] px-5 pt-10 pb-16">
        <h1 className="text-2xl mb-6">Hi {reg.basic.firstName}!</h1>

        <Card className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[12px] tracking-wide">Tournament Details</h3>
            <CalendarIcon size={17} className="text-accent-strong" />
          </div>
          <div className="text-sm font-semibold mb-1">{EVENT_INFO.name}</div>
          <div className="text-[12.5px] text-ink-soft">
            {formatDate(EVENT_INFO.date)} · {EVENT_INFO.time}
          </div>
          <div className="text-[12px] text-ink-faint mt-1.5">{EVENT_INFO.location}</div>
        </Card>

        <div className="flex items-start gap-3 rounded-l bg-warning-soft text-warning px-5 py-4">
          <ShieldIcon size={20} className="shrink-0 mt-0.5" />
          <p className="m-0 text-sm">
            Documents are under process. We will verify your consent shortly — until then, get ready for the tournament!
          </p>
        </div>
      </div>
    </main>
  );
}
