import type { ReactNode } from 'react';
import InfoTooltip from './InfoTooltip';

/**
 * Step title with an (i) icon beside it, in place of an explanatory paragraph under the title.
 * Mouse: hover the icon to read it. Touch: tap to open, tap again or elsewhere to close; Escape also closes.
 * The popover spans the header row (not just the icon), so long text stays inside the card on small screens.
 */
export default function StepHeaderWithInfo({ title, info }: { title: string; info: ReactNode }) {
  return (
    <div className="relative mb-5 flex items-center gap-2">
      <h2 className="m-0 text-xl">{title}</h2>
      <InfoTooltip label={title} anchor="parent">
        {info}
      </InfoTooltip>
    </div>
  );
}
