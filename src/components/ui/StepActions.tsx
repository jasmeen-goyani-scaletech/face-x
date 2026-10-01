import Button from './Button';
import { ChevronLeftIcon, ChevronRightIcon } from './Icons';

/**
 * Back / Continue row for every registration step.
 * Phones: pinned to the bottom of the screen while the step is on screen (so a long form never hides the button),
 * with each button sharing the full width. From 640px it's an ordinary row inside the card: Back on the left,
 * Continue on the right. The bar respects the iOS home-indicator inset.
 */
export default function StepActions({
  onBack,
  onNext,
  nextLabel = 'Continue',
  nextDisabled
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
}) {
  return (
    <div
      className={[
        'sticky bottom-0 z-10 -mx-5 -mb-5 mt-6 flex gap-3 rounded-b-l border-t border-line bg-surface px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]',
        'sm:static sm:mx-0 sm:mb-0 sm:border-0 sm:bg-transparent sm:p-0',
        onBack ? 'sm:justify-between' : 'sm:justify-end'
      ].join(' ')}
    >
      {onBack && (
        <Button variant="secondary" onClick={onBack} className="flex-1 sm:flex-none">
          <ChevronLeftIcon size={16} /> Back
        </Button>
      )}
      <Button variant="primary" onClick={onNext} disabled={nextDisabled} className="flex-1 sm:flex-none">
        {nextLabel} <ChevronRightIcon size={16} />
      </Button>
    </div>
  );
}
