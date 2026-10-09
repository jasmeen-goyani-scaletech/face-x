import { Suspense } from 'react';
import Topbar from '@/components/layout/Topbar';
import RequireAuth from '@/components/auth/RequireAuth';
import CoachEventDayRoster from '@/components/coach/CoachEventDayRoster';

export default function CoachEventDayPage() {
  return (
    <main>
      <Topbar eyebrow="Coach" />
      <div className="mx-auto max-w-[1100px] page-gutter pb-16 pt-6">
        <Suspense fallback={null}>
          <RequireAuth>
            <CoachEventDayRoster />
          </RequireAuth>
        </Suspense>
      </div>
    </main>
  );
}
