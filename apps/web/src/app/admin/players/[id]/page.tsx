import ApiRegistrationDetailView from '@/components/admin/ApiRegistrationDetailView';

export default function PlayerDetailPage({ params }: { params: { id: string } }) {
  return <ApiRegistrationDetailView id={params.id} kind="PLAYER" />;
}
