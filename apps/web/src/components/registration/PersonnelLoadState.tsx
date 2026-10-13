import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import type { PersonnelPhase } from '@/lib/registration/usePersonnelWizard';

/** What a coach or staff registration shows while it loads from the server, or when loading failed. Null once it is ready. */
export default function PersonnelLoadState({ phase, error, onRetry }: { phase: PersonnelPhase; error: string | null; onRetry: () => void }) {
  if (phase === 'loading') {
    return (
      <Card className="text-center">
        <span className="mx-auto mb-4 block h-8 w-8 rounded-full border-[3px] border-primary border-t-transparent animate-spin" aria-hidden />
        <p role="status" className="m-0 text-ink-soft">
          Loading your registration…
        </p>
      </Card>
    );
  }
  if (phase === 'error') {
    return (
      <Card className="text-center">
        <Alert level="danger" title="We couldn’t load your registration">
          {error}
        </Alert>
        <Button variant="primary" onClick={onRetry}>
          Try again
        </Button>
      </Card>
    );
  }
  return null;
}
