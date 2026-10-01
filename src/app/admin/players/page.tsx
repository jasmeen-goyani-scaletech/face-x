import RosterListPage from '@/components/admin/RosterListPage';

export default function PlayersPage() {
  return (
    <RosterListPage
      role="player"
      title="Players"
      description="Search, review documents, and track registration status."
      basePath="/admin/players"
    />
  );
}
