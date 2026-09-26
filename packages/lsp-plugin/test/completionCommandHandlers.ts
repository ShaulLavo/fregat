import type { EditorAnyCommandId } from '@singapore-editor/core/editor'
import type { EditorCommandHandler } from '@singapore-editor/core/extensions'
import type { CompletionController } from '../src/completionController'
import { COMPLETION_KEY_COMMANDS, type CompletionKeyCommand } from '../src/keyCommands'

/** A controller mounted without the plugin still answers the commands the plugin would route to it. */
export function completionCommandHandlers(
  controller: CompletionController,
): Map<EditorAnyCommandId, EditorCommandHandler> {
  return new Map(
    Object.entries(COMPLETION_KEY_COMMANDS).map(([command, id]) => [
      id,
      () => controller.runKeyCommand(command as CompletionKeyCommand),
    ]),
  )
}
