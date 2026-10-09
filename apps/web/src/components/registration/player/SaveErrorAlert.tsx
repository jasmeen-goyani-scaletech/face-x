import Alert from '@/components/ui/Alert';

/** What went wrong when a step tried to save to the server, with any field-level problems the API listed. */
export default function SaveErrorAlert({
  title = 'We couldn’t save that',
  error,
  fieldErrors
}: {
  title?: string;
  error: string | null;
  fieldErrors?: Record<string, string>;
}) {
  if (!error) return null;
  const details = Object.entries(fieldErrors ?? {});
  return (
    <div role="alert">
      <Alert level="danger" title={title}>
        {error}
        {details.length > 0 && (
          <span className="mt-1 block">
            {details.map(([path, message]) => (
              <span key={path} className="block">
                {path}: {message}
              </span>
            ))}
          </span>
        )}
      </Alert>
    </div>
  );
}
