import type { EditorPlugin, EditorViewContributionContext } from '@singapore-editor/core/extensions'
import {
  EDITOR_HOVER_PARTICIPANT,
  type HoverAnchor,
  type HoverPart,
} from '@singapore-editor/plugin-ui/hover-participant'
import { unicodeCharacterMessage } from '@/features/editor/utils/unicode-character-message'

/** After the language server's prose and its diagnostics, as VS Code orders it. */
const UNICODE_HOVER_ORDINAL = 5

/**
 * Explains a highlighted ambiguous or invisible character in the shared editor hover. The hover
 * plugin owns the pointer and the surface; this only answers what is at the offset.
 */
export function createUnicodeHoverPlugin(openSettings: () => void): EditorPlugin {
  return {
    name: 'platform.unicode-hover',
    activate: (context) =>
      context.registerViewContribution({
        createContribution: (view) => {
          const registration = view.registerProvider?.(
            EDITOR_HOVER_PARTICIPANT,
            { language: '*' },
            { computeSync: (request) => partsAt(view, request.anchor, openSettings) },
          )
          return {
            update: () => undefined,
            dispose: () => registration?.dispose(),
          }
        },
      }),
  }
}

function partsAt(
  context: EditorViewContributionContext,
  anchor: HoverAnchor,
  openSettings: () => void,
): readonly HoverPart[] {
  const marker =
    markerUnder(context.scrollElement, anchor) ?? markerAt(context.scrollElement, anchor.offset)
  if (!marker) return []

  const kind = marker.dataset.editorHiddenCharacter
  if (kind !== 'ambiguous' && kind !== 'invisible') return []

  const offset = Number(marker.dataset.editorHiddenCharacterOffset)
  if (!Number.isInteger(offset)) return []

  const snapshot = context.getSnapshot()
  const text =
    snapshot.textSnapshot?.readRange(offset, offset + 2) ??
    snapshot.fullText.slice(offset, offset + 2)
  const codePoint = text.codePointAt(0)
  if (codePoint === undefined) return []

  const length = codePoint > 0xffff ? 2 : 1
  return [
    {
      ordinal: UNICODE_HOVER_ORDINAL,
      range: { start: offset, end: offset + length },
      markdown: unicodeCharacterMessage(codePoint, kind),
      actions: [{ label: 'Adjust settings', run: openSettings }],
    },
  ]
}

/**
 * The marker under the pointer. A zero-width character has no text extent, so the offset the hit
 * test reports is a neighbour's; the marker the view paints for it is what the pointer is on, and
 * it is found by its rect because the markers are not hit-testable elements.
 */
function markerUnder(element: HTMLElement, anchor: HoverAnchor): HTMLElement | null {
  const point = anchor.point
  if (!point) return null
  const markers = element.querySelectorAll<HTMLElement>('[data-editor-hidden-character]')
  for (const marker of markers) {
    const rect = marker.getBoundingClientRect()
    if (point.clientX < rect.left || point.clientX > rect.right) continue
    if (point.clientY < rect.top || point.clientY > rect.bottom) continue
    return marker
  }
  return null
}

/** The painted marker for the character at `offset`; the view stamps each with its offset. */
function markerAt(element: HTMLElement, offset: number): HTMLElement | null {
  return element.querySelector<HTMLElement>(
    `[data-editor-hidden-character][data-editor-hidden-character-offset="${offset}"]`,
  )
}
