import Topbar from '@/components/layout/Topbar';
import CoachEventDayRoster from '@/components/coach/CoachEventDayRoster';

export default function CoachEventDayPage() {
  return (
    <main>
      <Topbar eyebrow="Coach" />
      <div className="mx-auto max-w-[1100px] page-gutter pb-16 pt-6">
        <CoachEventDayRoster />
      </div>
    </main>
  );
}
