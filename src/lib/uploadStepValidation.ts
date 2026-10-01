import { MSG } from './validation';

/**
 * Errors for a "Photo & documents" step: the photo plus every required document, all at once.
 * Keys equal the element ids to focus (the photo's capture button, each row's Upload button), and `order` is the
 * on-screen order, so `useFieldErrors` can scroll to and focus the first invalid one.
 */
export function uploadStepErrors(
  photo: { id: string; uploaded: boolean },
  docs: { id: string; label: string; required: boolean; uploaded: boolean }[]
) {
  const errors: Record<string, string> = {};
  if (!photo.uploaded) errors[photo.id] = MSG.photo;
  for (const d of docs) if (d.required && !d.uploaded) errors[d.id] = `Upload your ${d.label}.`;
  return { errors, order: [photo.id, ...docs.map((d) => d.id)] };
}
