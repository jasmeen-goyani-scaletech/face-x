import Alert from '@/components/ui/Alert';
import Card from '@/components/ui/Card';

const WHO = { player: 'players', coach: 'coaches', staff: 'staff members' } as const;

/**
 * Shown instead of a registration form when the team the invite link points at has no places left for this kind of
 * registrant. The limit is also enforced by the API when the registration is submitted; this saves the person from filling in
 * a form that cannot be accepted.
 */
export default function RegistrationFullCard({ teamName, kind }: { teamName: string; kind: keyof typeof WHO }) {
  return (
    <Card>
      <Alert level="warning" title="Registration is currently full for this team">
        {teamName} is not accepting any more {WHO[kind]} right now. Please contact the organizer if you think this is a mistake.
      </Alert>
    </Card>
  );
}
