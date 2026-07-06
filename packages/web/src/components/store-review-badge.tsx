/** Amber status pill for the pending Chrome Web Store submission.
 *  Delete (or swap for a store link) once the extension is approved. */
export function StoreReviewBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-400/10 dark:text-amber-400">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
      Chrome Web Store review in progress
    </span>
  );
}
