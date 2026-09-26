/**
 * Whether keyboard focus sits inside the current screen's sidebar. Hiding the
 * sidebar unmounts that element, so the command has to move focus first.
 */
export function focusInsideSidebar() {
  return document.activeElement?.closest('[data-screen-sidebar]') != null
}
