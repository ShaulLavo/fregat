import type {
  EditorDisposable,
  EditorPlugin,
  EditorPluginContext,
} from '@singapore-editor/core/extensions'
import { createTreeSitterSyntaxPlugin } from '@singapore-editor/tree-sitter'

import {
  createHighlightingService,
  type HighlightingService,
  type HighlightingThemeSelection,
  type HighlightingThemeSource,
} from './service'

export type HighlightingPluginOptions = {
  /** Borrowed: the plugin never disposes it. Omitted, each activation owns a service of its own. */
  readonly service?: HighlightingService
  /** Defaults to the editor's own palette, colored by Tree-sitter captures. */
  readonly theme?: HighlightingThemeSelection | HighlightingThemeSource
  readonly name?: string
}

const EDITOR_PALETTE: HighlightingThemeSource = { current: () => ({ format: 'editor' }) }

/**
 * Syntax for an editor: Tree-sitter structure always, with colors from the editor palette or, under
 * an imported theme, from its TextMate rules. Changing between the two swaps only the colors.
 */
export function createHighlightingPlugin(options: HighlightingPluginOptions = {}): EditorPlugin {
  const theme = themeSource(options.theme)
  const name = options.name ?? 'highlighting'

  return {
    name,
    activate(context) {
      const owned = options.service ? null : createHighlightingService()
      const service = options.service ?? (owned as HighlightingService)
      const structure = createTreeSitterSyntaxPlugin(service.syntaxProvider(), {
        name: `${name}.structure`,
      }).activate(context)
      const colors = bindImportedColors(context, service, theme)

      return {
        dispose: () => {
          colors.dispose()
          disposeActivation(structure)
          void owned?.dispose()
        },
      }
    },
  }
}

// The Tree-sitter token output steps aside by itself while a highlighter session exists.
function bindImportedColors(
  context: EditorPluginContext,
  service: HighlightingService,
  theme: HighlightingThemeSource,
): EditorDisposable {
  let registration: EditorDisposable | null = null
  const sync = () => {
    const wanted = service.usesHighlighter(theme)
    if (wanted === (registration !== null)) return

    registration?.dispose()
    registration = wanted ? context.registerHighlighter(service.highlighterProvider(theme)) : null
  }

  sync()
  const unsubscribe = theme.subscribe?.(sync)
  return {
    dispose: () => {
      unsubscribe?.()
      registration?.dispose()
      registration = null
    },
  }
}

function themeSource(
  theme: HighlightingThemeSelection | HighlightingThemeSource | undefined,
): HighlightingThemeSource {
  if (!theme) return EDITOR_PALETTE
  if ('current' in theme) return theme
  return { current: () => theme }
}

function disposeActivation(result: ReturnType<EditorPlugin['activate']>): void {
  if (!result) return
  if (Array.isArray(result)) {
    for (const disposable of result as readonly EditorDisposable[]) disposable.dispose()
    return
  }
  ;(result as EditorDisposable).dispose()
}
