import type {
  EditorPlugin,
  EditorPluginContext,
  EditorViewContributionContext,
} from '@singapore-editor/core/extensions'

import { createHoverController, type HoverController } from './hoverController'
import { clearHoverController, setHoverController } from './hoverRegistry'

export type HoverPluginOptions = {
  readonly name?: string
  readonly classNamespace?: string
  readonly markdownCodeBackground?: boolean
}

type LiveHover = {
  readonly context: EditorViewContributionContext
  readonly controller: HoverController
}

/**
 * The one hover per view and the command that summons it from the caret. Participants register
 * through EDITOR_HOVER_PARTICIPANT; this plugin has no content of its own. An editor installs it by
 * itself once a participant registers (see hoverToken.ts); a test with a hand-made view context
 * installs it directly.
 */
export function createHoverPlugin(options: HoverPluginOptions = {}): EditorPlugin {
  return {
    name: options.name ?? 'editor.hover',
    activate: (plugin) => activateHover(plugin, options),
  }
}

function activateHover(plugin: EditorPluginContext, options: HoverPluginOptions) {
  // Per activation, so the command only walks the views of the editor that dispatched it.
  const live = new Set<LiveHover>()
  return [
    plugin.registerViewContribution({
      createContribution: (context) => {
        const controller = createHoverController({ context, ...options })
        const entry: LiveHover = { context, controller }
        live.add(entry)
        setHoverController(context.scrollElement, controller)
        return {
          update: (snapshot, kind) => controller.update(snapshot, kind),
          dispose: () => {
            live.delete(entry)
            clearHoverController(context.scrollElement, controller)
            controller.dispose()
          },
        }
      },
    }),
    plugin.registerCommandContribution({
      createContribution: (commands) =>
        commands.registerCommand('editor.action.showHover', () => {
          for (const { context, controller } of live) {
            const selection = context.getSnapshot().selections[0]
            if (!selection) continue
            if (controller.showAtOffset(selection.headOffset, { focus: true })) return true
          }
          return false
        }),
    }),
  ]
}
