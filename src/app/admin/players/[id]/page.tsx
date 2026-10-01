import PlayerDetailView from '@/components/admin/PlayerDetailView';

export default function PlayerDetailPage({ params }: { params: { id: string } }) {
  return <PlayerDetailView id={params.id} />;
}
