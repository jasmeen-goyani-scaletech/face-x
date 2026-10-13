'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Accessible modal shell shared by every dialog (confirmations, forms, viewers).
 * - Focus moves in on open (to `initialFocus`, else the first control), is trapped, and returns to the trigger on close.
 * - Escape and a click on the backdrop call `onClose`; both are ignored while `busy`.
 * - Page scroll is locked while open.
 */
export default function Dialog({
  open,
  onClose,
  labelledBy,
  describedBy,
  role = 'dialog',
  busy = false,
  size = 'sm',
  initialFocus = 'button, textarea, select, input, a[href]',
  children
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  describedBy?: string;
  role?: 'dialog' | 'alertdialog';
  busy?: boolean;
  size?: 'sm' | 'md' | 'xl';
  /** CSS selector of the element that receives focus first. */
  initialFocus?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  // Latest values for the key handler, so the effect below only re-runs when the dialog opens or closes.
  const live = useRef({ busy, onClose });
  live.current = { busy, onClose };

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    (panelRef.current?.querySelector<HTMLElement>(initialFocus) ?? panelRef.current)?.focus();

    const FOCUSABLE = 'button:not([disabled]), textarea:not([disabled]), select:not([disabled]), input:not([disabled]), a[href]';
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (!live.current.busy) live.current.onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !mounted) return null;

  const width = size === 'xl' ? 'max-w-[960px]' : size === 'md' ? 'max-w-[520px]' : 'max-w-[420px]';

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={['w-full max-h-[92vh] overflow-auto rounded-l border border-line bg-surface p-6 shadow-2xl focus:outline-none', width].join(' ')}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
