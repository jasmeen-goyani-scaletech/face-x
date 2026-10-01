import RosterListPage from '@/components/admin/RosterListPage';

export default function CoachesPage() {
  return (
    <RosterListPage
      role="coach"
      title="Coaches"
      description="Search, review certificates, and approve or reject coach registrations."
      basePath="/admin/coaches"
    />
  );
}
