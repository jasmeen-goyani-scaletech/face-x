import StaffDetailView from '@/components/admin/StaffDetailView';

export default function StaffDetailPage({ params }: { params: { id: string } }) {
  return <StaffDetailView id={params.id} />;
}
