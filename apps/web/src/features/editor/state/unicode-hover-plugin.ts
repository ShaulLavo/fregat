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
          const registration = view.registerProvider(
            EDITOR_HOVER_PARTICIPANT,
            { language: '*' },
            { computeSync: (request) => partsAt(view, request.anchor, openSettings) },
          )
          return {
            update: () => undefined,
            dispose: () => registration.dispose(),
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
  const marker = markerUnder(context, anchor) ?? markerAt(context, anchor.offset)
  if (!marker) return []

  const { kind, offset } = marker
  if (kind !== 'ambiguous' && kind !== 'invisible') return []

  const snapshot = context.getSnapshot()
  const text = snapshot.textSnapshot.readRange(offset, offset + 2)
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
 * test reports is a neighbour's; the marker the view paints for it is what the pointer is on.
 */
function markerUnder(context: EditorViewContributionContext, anchor: HoverAnchor) {
  const point = anchor.point
  if (!point) return null
  return context.markerAtPoint(point.clientX, point.clientY)
}

/** A keyboard hover has no point, so ask at the character's own box; +1px lands on a 2px marker. */
function markerAt(context: EditorViewContributionContext, offset: number) {
  const rect = context.getRangeClientRect(offset, offset + 1)
  if (!rect) return null
  return context.markerAtPoint(rect.left + Math.max(1, rect.width / 2), rect.top + rect.height / 2)
}
