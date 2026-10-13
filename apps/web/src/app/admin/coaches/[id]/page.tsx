import ApiRegistrationDetailView from '@/components/admin/ApiRegistrationDetailView';

export default function CoachDetailPage({ params }: { params: { id: string } }) {
  return <ApiRegistrationDetailView id={params.id} kind="COACH" />;
}
