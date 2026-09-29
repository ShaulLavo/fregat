import type { HoverController } from './hoverController'

/**
 * The hover controller of each view, kept apart from the plugin that fills it. A plugin that has to
 * hide the hover when its own surface opens reads this; importing the plugin instead would anchor
 * the hover surface, its Markdown renderer and their dependencies into whoever asked, which is the
 * load hoverToken.ts defers.
 */
const controllers = new WeakMap<HTMLElement, HoverController>()

/** Null before the hover has activated on that view. */
export function hoverControllerFor(scrollElement: HTMLElement): HoverController | null {
  return controllers.get(scrollElement) ?? null
}

export function setHoverController(scrollElement: HTMLElement, controller: HoverController): void {
  controllers.set(scrollElement, controller)
}

/** Ignores a controller that a later activation has already replaced. */
export function clearHoverController(
  scrollElement: HTMLElement,
  controller: HoverController,
): void {
  if (controllers.get(scrollElement) !== controller) return
  controllers.delete(scrollElement)
}
