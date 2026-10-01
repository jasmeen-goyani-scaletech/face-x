import Topbar from '@/components/layout/Topbar';
import CoachPlayerRosterView from '@/components/coach/CoachPlayerRosterView';

export default function CoachTeamRosterPage() {
  return (
    <main>
      <Topbar eyebrow="Coach" />
      <div className="mx-auto max-w-[1100px] page-gutter pb-16 pt-6">
        <CoachPlayerRosterView />
      </div>
    </main>
  );
}
