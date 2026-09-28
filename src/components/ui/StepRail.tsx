import { CheckIcon } from './Icons';

export interface Step {
  key: string;
  label: string;
}

export default function StepRail({ steps, current }: { steps: Step[]; current: string }) {
  const idx = steps.findIndex((s) => s.key === current);
  return (
    <div className="flex gap-1 overflow-x-auto pb-1 mb-6 momentum-scroll">
      {steps.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <div
            key={s.key}
            className={[
              'flex-1 min-w-[76px] text-center px-1.5 pt-2 pb-2 border-b-[3px]',
              done || active ? 'border-accent' : 'border-line',
              done ? 'text-accent-strong' : active ? 'text-ink' : 'text-ink-faint'
            ].join(' ')}
          >
            <span className="block font-display text-[13px] font-bold">
              {done ? <CheckIcon size={13} /> : i + 1}
            </span>
            <span className="block text-[10.5px] uppercase tracking-wide font-semibold whitespace-nowrap mt-0.5">
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
