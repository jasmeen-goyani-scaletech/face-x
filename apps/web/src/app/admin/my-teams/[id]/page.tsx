import MyTeamDetail from '@/components/admin/MyTeamDetail';

export default function MyTeamPage({ params }: { params: { id: string } }) {
  return <MyTeamDetail teamId={params.id} />;
}
