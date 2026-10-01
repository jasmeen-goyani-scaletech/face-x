import { CheckIcon } from './Icons';

export interface Step {
  key: string;
  label: string;
}

/**
 * Registration progress as connected circular nodes.
 *
 *  - Done: solid theme circle with a white check.
 *  - Current: solid circle with the step number and a soft outer ring; its title is bold.
 *  - Upcoming: muted outlined circle with the number and a faint title.
 *  - A grey track runs between the nodes and fills with the theme colour up to the current step.
 *
 * Each step is two stacked blocks: a fixed-height NODE ROW (circle + the track segment, both centred in it) and, below
 * it, a LABEL block. The node row is tall enough to contain the circle plus its 4px ring, so nothing paints outside it
 * and the label can never touch the circle. The track is positioned against the node row, not the whole column, so it
 * always passes through the exact centre of every circle.
 *
 * From 640px titles sit under the nodes (max 110px wide, centred, wrapping). On phones the titles are hidden from sight
 * and the current one is shown once, below the bar, as "Step 2 of 3 · Photo & Documents". Titles remain available to
 * screen readers at every size. Motion is CSS transitions, disabled for reduced-motion users.
 */
export default function ModernStepper({ steps, current }: { steps: Step[]; current: string }) {
  const idx = Math.max(
    0,
    steps.findIndex((s) => s.key === current)
  );
  const active = steps[idx];

  return (
    <nav aria-label="Registration progress" className="mb-6">
      <ol className="m-0 flex list-none items-start p-0">
        {steps.map((s, i) => {
          const done = i < idx;
          const isActive = i === idx;
          const isLast = i === steps.length - 1;
          return (
            <li key={s.key} aria-current={isActive ? 'step' : undefined} className="flex min-w-0 flex-1 flex-col items-center">
              {/* Node row: 32px on phones, 40px from 640px. Holds the circle (+ring) and the track, both centred in it. */}
              <div className="relative flex h-8 w-full items-center justify-center sm:h-10">
                {!isLast && (
                  <span
                    aria-hidden="true"
                    className="absolute left-1/2 top-1/2 z-0 h-0.5 w-full -translate-y-1/2 overflow-hidden rounded-full bg-line"
                  >
                    <span
                      className="block h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
                      style={{ width: done ? '100%' : '0%' }}
                    />
                  </span>
                )}
                <span
                  className={[
                    'relative z-10 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold transition-colors duration-300 motion-reduce:transition-none sm:h-8 sm:w-8 sm:text-[13px]',
                    done
                      ? 'bg-primary text-primary-foreground ring-4 ring-paper'
                      : isActive
                        ? 'bg-primary text-primary-foreground ring-4 ring-primary-light'
                        : 'border-2 border-line bg-surface text-ink-faint ring-4 ring-paper'
                  ].join(' ')}
                >
                  {done ? <CheckIcon size={14} strokeWidth={3} /> : i + 1}
                </span>
              </div>

              {/* Label block: its own stacked element below the node row, never overlapping it. */}
              <span
                className={[
                  'mt-2 block w-full max-w-[110px] break-words px-1 text-center text-[10.5px] uppercase leading-tight tracking-wide transition-colors',
                  'sr-only sm:not-sr-only',
                  isActive ? 'font-bold text-ink' : done ? 'font-semibold text-primary-strong' : 'font-semibold text-ink-faint'
                ].join(' ')}
              >
                <span className="sr-only">{done ? 'Completed: ' : isActive ? 'Current step: ' : 'Upcoming: '}</span>
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>

      {/* Phones: the current step's title, once, under the bar. */}
      <p className="m-0 mt-3 flex items-baseline justify-center gap-2 text-center sm:hidden">
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Step {idx + 1} of {steps.length}
        </span>
        <span className="text-ink-faint" aria-hidden="true">
          ·
        </span>
        <span className="min-w-0 truncate font-display text-sm font-bold uppercase tracking-wide text-ink">{active.label}</span>
      </p>
    </nav>
  );
}
