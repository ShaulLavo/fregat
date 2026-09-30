import type { Editor } from '../src/editor/Editor'

/**
 * The element the editor binds its input listeners to.
 *
 * `el` is `private` on Editor and there is no seam for it, because nothing but a test has business
 * reaching it: it is `view.scrollElement`, which the editor hands to plugins through their
 * contribution context and to nobody else. An integration test that dispatches a real `keydown` or
 * `beforeinput` has to aim at this exact node — listeners sit here, and events bubble upward, so a
 * dispatch on the container never arrives.
 *
 * `document.querySelector('.editor-virtualized')` is the obvious alternative and is wrong: every
 * VirtualizedTextView carries that class, so the query can return a secondary view's scroll element
 * and silently change which editor the test is typing into.
 *
 * Kept in one place so the reach into a private field is one line rather than ten.
 */
export function editorElement(editor: Editor): HTMLDivElement {
  return editor['el']
}
