import { Suspense } from 'react';
import Topbar from '@/components/layout/Topbar';
import RequireAuth from '@/components/auth/RequireAuth';
import CoachPlayerRosterView from '@/components/coach/CoachPlayerRosterView';

export default function CoachTeamRosterPage() {
  return (
    <main>
      <Topbar eyebrow="Coach" />
      <div className="mx-auto max-w-[1100px] page-gutter pb-16 pt-6">
        <Suspense fallback={null}>
          <RequireAuth>
            <CoachPlayerRosterView />
          </RequireAuth>
        </Suspense>
      </div>
    </main>
  );
}
