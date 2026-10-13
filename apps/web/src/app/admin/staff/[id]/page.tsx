import ApiRegistrationDetailView from '@/components/admin/ApiRegistrationDetailView';

export default function StaffDetailPage({ params }: { params: { id: string } }) {
  return <ApiRegistrationDetailView id={params.id} kind="STAFF" />;
}
