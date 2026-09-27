const TRIGGER = '[aria-haspopup]'

/**
 * The nearest popup trigger (Select, Menu, Popover, Combobox, …) at or above `node` whose popup
 * is open or opening, or null.
 *
 * Base UI flips `aria-expanded` on a trigger synchronously when its popup starts opening, before
 * positioning (`alignItemWithTrigger`) moves focus off the trigger and into the popup. During
 * that gap the trigger is still the focused, contained descendant a dialog's own key handling
 * would otherwise see — this is the only signal available to tell the two states apart, and it
 * is the same selector Base UI's own floating interactions use internally.
 */
export function openingPopupTrigger(node: EventTarget | null): Element | null {
  if (!(node instanceof Element)) return null
  const trigger = node.closest(TRIGGER)
  return trigger?.getAttribute('aria-expanded') === 'true' ? trigger : null
}
