'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { InfoIcon, XIcon } from './Icons';

/**
 * `(i)` icon with an explanation.
 * Mouse: a popover that opens on hover. Touch / pen: tapping opens a bottom sheet (full width, thumb-reachable, can't
 * run off a narrow screen) that closes with a second tap on the icon, the close button, the dimmed backdrop, or Escape.
 * Keyboard: Enter/Space toggles the popover. The icon's tap area is padded out to 44px without changing how it looks.
 */
export default function InfoTooltip({
  label,
  children,
  anchor = 'icon'
}: {
  label: string;
  children: React.ReactNode;
  /** `icon`: the popover hangs off the icon. `parent`: it spans the nearest positioned ancestor — use for long text next to a title. */
  anchor?: 'icon' | 'parent';
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const lastPointer = useRef<string>('keyboard');

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function onIconClick() {
    const type = lastPointer.current;
    lastPointer.current = 'keyboard';
    if (type === 'touch' || type === 'pen') {
      setSheet(true);
      setOpen((o) => !o);
    } else {
      // With a mouse the hover already opened it, so a click must not close it again.
      setSheet(false);
      setOpen((o) => (type === 'mouse' ? true : !o));
    }
  }

  return (
    <span
      ref={rootRef}
      className={anchor === 'icon' ? 'relative inline-flex' : 'inline-flex'}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') {
          setSheet(false);
          setOpen(true);
        }
      }}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setOpen(false)}
    >
      <button
        type="button"
        aria-label={`More about ${label}`}
        aria-expanded={open}
        aria-describedby={open && !sheet ? id : undefined}
        onPointerDown={(e) => {
          lastPointer.current = e.pointerType;
        }}
        onClick={onIconClick}
        className="relative flex h-5 w-5 items-center justify-center rounded-full text-ink-faint before:absolute before:-inset-3 before:content-[''] hover:text-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <InfoIcon size={15} />
      </button>

      {open && !sheet && (
        <span
          id={id}
          role="tooltip"
          className={[
            'absolute left-0 top-full z-30 mt-1.5 rounded-s bg-ink px-3 py-2 text-left text-[12.5px] font-medium leading-snug text-surface shadow-lg',
            anchor === 'icon' ? 'w-60 max-w-[calc(100vw-3rem)]' : 'w-full max-w-sm'
          ].join(' ')}
        >
          {children}
        </span>
      )}

      {open && sheet && (
        <>
          <span aria-hidden="true" className="fixed inset-0 z-40 bg-black/40" onClick={() => setOpen(false)} />
          <span
            role="dialog"
            aria-label={label}
            className="fixed inset-x-0 bottom-0 z-50 block rounded-t-l border-t border-line bg-surface px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-left shadow-2xl"
          >
            <span className="mb-2 flex items-start justify-between gap-3">
              <span className="font-display text-base font-bold uppercase tracking-wide text-ink">{label}</span>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="touch-target -mr-2 -mt-2 flex items-center justify-center rounded-s text-ink-soft"
              >
                <XIcon size={18} />
              </button>
            </span>
            <span className="block text-[14.5px] leading-snug text-ink-soft">{children}</span>
          </span>
        </>
      )}
    </span>
  );
}
