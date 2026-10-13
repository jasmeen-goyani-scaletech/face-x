import Link from 'next/link';
import Topbar from '@/components/layout/Topbar';
import { CheckIcon, ShieldIcon, TrophyIcon, UsersIcon } from '@/components/ui/Icons';

export default function HomePage() {
  return (
    <main>
      <Topbar />
      <div className="mx-auto max-w-[640px] page-gutter pt-8 pb-16">
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground font-display font-bold text-2xl">
            FX
          </div>
          <h1 className="text-3xl mb-2">Face-X</h1>
          <p className="text-ink-soft">
            Verified registration and event-day check-in for California youth football — players, coaches, and staff, all in one place.
          </p>
        </div>

        <div className="grid gap-3">
          <Link
            href="/register"
            className="flex items-center justify-between rounded-l border border-line bg-surface px-5 py-4 no-underline hover:border-primary"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-s bg-primary-light text-primary-strong">
                <TrophyIcon size={20} />
              </span>
              <div>
                <div className="font-bold text-ink">Start Registration</div>
                <div className="text-[13px] text-ink-soft">Player, coach, or staff — pick your role next.</div>
              </div>
            </div>
          </Link>
        </div>

        <div className="mt-10 grid grid-cols-3 gap-3 text-center">
          <div>
            <CheckIcon size={16} className="mx-auto mb-1 text-primary-strong" />
            <div className="text-[11px] text-ink-faint font-semibold uppercase tracking-wide">Verified IDs</div>
          </div>
          <div>
            <UsersIcon size={16} className="mx-auto mb-1 text-primary-strong" />
            <div className="text-[11px] text-ink-faint font-semibold uppercase tracking-wide">All Roles</div>
          </div>
          <div>
            <ShieldIcon size={16} className="mx-auto mb-1 text-primary-strong" />
            <div className="text-[11px] text-ink-faint font-semibold uppercase tracking-wide">Safe-Sport</div>
          </div>
        </div>
      </div>
    </main>
  );
}
