import { documentLinkAtOffset, documentLinksInRows, type DocumentLink } from './documentLinks'
import { createPlugin, derive, visibleRowsInput } from './createPlugin'
import type { EditorPlugin } from './plugins'
import type { VirtualizedTextHighlightStyle } from './virtualization'

export const EDITOR_DOCUMENT_LINK_PLUGIN_ID = 'editor.documentLink'

const DEFAULT_LINK_STYLE: VirtualizedTextHighlightStyle = {
  textDecoration: 'underline',
}

export type EditorDocumentLinkPluginOptions = {
  /** Paint for a link that is ready to be followed. */
  readonly style?: VirtualizedTextHighlightStyle
  /**
   * Opens a followed link. Defaults to a new browser tab with `noopener`; a host that renders
   * outside a browser, or wants its own confirmation, supplies its own.
   */
  readonly openLink?: (url: string) => void
}

/**
 * Underlines http(s) URLs in the buffer and opens them on modifier-click, the affordance every
 * editor gives a link in a comment.
 *
 * Only the mounted rows are scanned — an off-screen link cannot be clicked.
 */
export function createDocumentLinkPlugin(
  options: EditorDocumentLinkPluginOptions = {},
): EditorPlugin {
  const style = options.style ?? DEFAULT_LINK_STYLE
  const openLink = options.openLink ?? openLinkInNewTab
  return createPlugin({
    name: EDITOR_DOCUMENT_LINK_PLUGIN_ID,
    view(scope) {
      const { view } = scope
      const name = `${view.highlightPrefix}-document-link`
      let links: readonly DocumentLink[] = []
      let painted = false
      const clear = () => {
        links = []
        if (!painted) return
        painted = false
        view.clearRangeHighlight(name)
      }

      scope.watch(linksInput, (next) => {
        if (next.length === 0) {
          clear()
          return
        }
        links = next
        painted = true
        view.setRangeHighlight(
          name,
          next.map((link) => ({ end: link.end, start: link.start })),
          style,
        )
      })

      // A plain click has to stay a caret placement, or editing text that contains a URL becomes
      // impossible: a link follows on modifier-click only.
      const handleClick = (event: MouseEvent): void => {
        // Something inside the editor already acted on this click, such as a diff separator expanding.
        if (event.defaultPrevented) return
        if (!event.metaKey && !event.ctrlKey) return
        if (links.length === 0) return

        const offset = view.textOffsetFromPoint(event.clientX, event.clientY)
        if (offset === null) return

        const link = documentLinkAtOffset(links, offset)
        if (!link) return

        event.preventDefault()
        openLink(link.url)
      }
      view.container.addEventListener('click', handleClick)
      scope.onDispose(() => {
        view.container.removeEventListener('click', handleClick)
        clear()
      })
    },
  })
}

// Only the mounted rows are scanned — an off-screen link cannot be clicked.
const linksInput = derive([visibleRowsInput], (rows) => documentLinksInRows(rows))

function openLinkInNewTab(url: string): void {
  if (typeof window === 'undefined') return

  // noopener so the opened page cannot reach back through window.opener.
  window.open(url, '_blank', 'noopener,noreferrer')
}
