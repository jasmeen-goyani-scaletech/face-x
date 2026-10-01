import CoachDetailView from '@/components/admin/CoachDetailView';

export default function CoachDetailPage({ params }: { params: { id: string } }) {
  return <CoachDetailView id={params.id} />;
}
