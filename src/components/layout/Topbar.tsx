import Link from 'next/link';

export default function Topbar({ eyebrow }: { eyebrow?: string }) {
  return (
    <div
      className="sticky z-20 flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3"
      style={{ top: 'env(safe-area-inset-top, 0px)' }}
    >
      <Link href="/" className="flex items-baseline gap-2 font-display font-bold text-xl tracking-wide text-ink no-underline">
        <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-accent text-accent-ink text-sm font-bold">
          FX
        </span>
        FACE-X
        {eyebrow && <small className="font-body font-medium normal-case text-xs text-ink-faint tracking-normal">{eyebrow}</small>}
      </Link>
      <nav className="flex items-center gap-1 rounded-full border border-line bg-surface-2 p-1">
        <Link href="/register" className="rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink">
          Player Registration
        </Link>
        <Link href="/admin/scan" className="rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink">
          Switch to Field Admin Mode
        </Link>
      </nav>
    </div>
  );
}
