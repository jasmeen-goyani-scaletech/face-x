import Link from 'next/link';

export default function Topbar({ eyebrow }: { eyebrow?: string }) {
  return (
    <div
      className="sticky z-20 flex items-center justify-between gap-2 border-b border-line bg-surface px-4 py-2.5 sm:gap-3 sm:px-5 sm:py-3"
      style={{ top: 'env(safe-area-inset-top, 0px)' }}
    >
      <Link href="/" className="flex min-w-0 flex-1 items-center gap-2 font-display font-bold text-lg tracking-wide text-ink no-underline sm:text-xl">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-accent text-accent-ink text-sm font-bold leading-none">
          FX
        </span>
        <span className="flex min-w-0 flex-col justify-center leading-tight">
          <span className="truncate">FACE-X</span>
          {eyebrow && (
            <small className="truncate font-body font-medium normal-case text-[11px] leading-tight text-ink-faint tracking-normal">
              {eyebrow}
            </small>
          )}
        </span>
      </Link>
      <nav className="flex shrink-0 items-center gap-1 rounded-full border border-line bg-surface-2 p-1">
        <Link
          href="/register"
          className="whitespace-nowrap rounded-full px-3 py-2 text-[11.5px] font-semibold leading-none text-ink-soft hover:text-ink sm:px-3.5 sm:py-1.5 sm:text-[12.5px]"
        >
          <span className="sm:hidden">Register</span>
          <span className="hidden sm:inline">Player Registration</span>
        </Link>
        <Link
          href="/admin/scan"
          className="whitespace-nowrap rounded-full px-3 py-2 text-[11.5px] font-semibold leading-none text-ink-soft hover:text-ink sm:px-3.5 sm:py-1.5 sm:text-[12.5px]"
        >
          <span className="sm:hidden">Field Admin</span>
          <span className="hidden sm:inline">Switch to Field Admin Mode</span>
        </Link>
      </nav>
    </div>
  );
}
