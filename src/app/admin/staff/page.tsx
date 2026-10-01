import RosterListPage from '@/components/admin/RosterListPage';

export default function StaffPage() {
  return (
    <RosterListPage
      role="staff"
      title="Staff Members"
      description="Search, review documents, and approve or reject staff registrations."
      basePath="/admin/staff"
    />
  );
}
