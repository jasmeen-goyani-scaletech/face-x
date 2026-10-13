import { AwardIcon, CameraIcon, FileCheckIcon, FileTextIcon, IdCardIcon, ShieldCheckIcon } from './Icons';
import { documentKind, type DocumentKind } from '@/lib/documentKinds';
import type { UploadedFile } from '@/lib/types';

const KIND_ICON: Record<DocumentKind, typeof FileTextIcon> = {
  document: FileTextIcon,
  certificate: AwardIcon,
  id: IdCardIcon,
  safety: ShieldCheckIcon,
  photo: CameraIcon
};

const BASE = 'flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-s border';

/**
 * The square at the start of every document row, in upload and admin review alike.
 * Empty: the icon for the document's *type* (never an upload arrow — that belongs to the action button).
 * Uploaded: a thumbnail for images, otherwise a green checked file. Rejected: the type icon in red.
 * Purely visual — wrap it in a button when it should open a preview.
 */
export default function DocumentIconBox({ documentId, file }: { documentId: string; file: UploadedFile }) {
  const Icon = KIND_ICON[documentKind(documentId)];

  if (!file.uploaded) {
    return (
      <span aria-hidden="true" className={[BASE, 'border-line bg-surface-2 text-ink-faint'].join(' ')}>
        <Icon size={18} />
      </span>
    );
  }
  if (file.review === 'rejected') {
    return (
      <span aria-hidden="true" className={[BASE, 'border-danger bg-danger-soft text-danger'].join(' ')}>
        <Icon size={18} />
      </span>
    );
  }
  if (file.dataUrl?.startsWith('data:image')) {
    return (
      <span aria-hidden="true" className={[BASE, 'border-line bg-surface-2'].join(' ')}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={file.dataUrl} alt="" className="h-full w-full object-cover" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={[BASE, 'border-success bg-success-soft text-success'].join(' ')}>
      <FileCheckIcon size={18} />
    </span>
  );
}
