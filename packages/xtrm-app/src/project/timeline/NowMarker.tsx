/**
 * The now marker (console-ui-system §5): one horizontal hairline in the danger
 * token plus the word `now`. It sits between the events that have already
 * happened and the ones that have not, so the agenda reads in time order.
 *
 * The word is the carrier; colour only reinforces it (Restraint rule 4).
 */
export function NowMarker() {
  return (
    <div role="separator" aria-label="now" data-testid="now-marker" className="flex items-center gap-2 px-3 py-1">
      <span className="text-[10px] font-medium tracking-wide text-danger uppercase">now</span>
      <span className="h-px flex-1 border-t border-danger" />
    </div>
  );
}
