import type { EditorPlugin } from '@singapore-editor/core/extensions'
import { SpellcheckController, type SpellcheckChecker } from './controller'
import { EDITOR_SPELLCHECK_FEATURE } from './feature'
import type { SpellcheckScope } from './proseRanges'

export type SpellcheckPluginOptions = {
  /** The page's one service, shared by every editor. */
  readonly service: SpellcheckChecker
  /** Defaults to `prose`: plain text and Markdown. */
  readonly scope?: SpellcheckScope
}

/** Marks misspelled words on and near the screen, and registers `EDITOR_SPELLCHECK_FEATURE`. */
export function createSpellcheckPlugin(options: SpellcheckPluginOptions): EditorPlugin {
  return {
    name: 'editor.spellcheck',
    activate(context) {
      const controller = new SpellcheckController(options.service, options.scope ?? 'prose')
      return [
        context.registerViewContribution({
          createContribution: (view) => {
            const attachment = controller.attachView(view)
            return {
              update: (snapshot, kind) => controller.update(snapshot, kind),
              dispose: () => attachment.dispose(),
            }
          },
        }),
        context.registerEditContribution({
          createContribution: (edit) => controller.attachEdit(edit),
        }),
        context.registerCapabilityContribution({
          createContribution: (capability) =>
            capability.registerFeature(EDITOR_SPELLCHECK_FEATURE, controller.feature()),
        }),
      ]
    },
  }
}
