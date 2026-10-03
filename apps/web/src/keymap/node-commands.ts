import type { WorkspaceCommandHandlerContext } from '@/keymap/define-command'
import { chatCommandMetadata } from '@workspace/client-core/commands/chat'
import { workbenchCommandMetadata } from '@workspace/client-core/commands/workbench'
import {
  localCommandMetadata,
  questionCommandMetadata,
  terminalSendKeystrokeMetadata,
} from '@workspace/client-core/commands/node'

const metadata = [
  chatCommandMetadata['chat.stashPrompt'],
  chatCommandMetadata['chat.sendMessage'],
  workbenchCommandMetadata['git.commit'],
  workbenchCommandMetadata['fileTree.rename'],
  workbenchCommandMetadata['terminal.close'],
  workbenchCommandMetadata['terminal.clear'],
  workbenchCommandMetadata['terminal.copy'],
  workbenchCommandMetadata['terminal.paste'],
  terminalSendKeystrokeMetadata,
  ...questionCommandMetadata,
  ...localCommandMetadata,
]

// Mounted feature nodes execute these commands; the workspace ancestor declines them.
export const nodeCommands = metadata.map((command) => ({
  ...command,
  execution: 'sync' as const,
  run: ({ runtime, invocation }: WorkspaceCommandHandlerContext) =>
    runtime.keymap.dispatch(command.id, invocation)
      ? { status: 'handled' as const }
      : { status: 'unhandled' as const, reason: 'handler-declined' as const },
}))

export const nodeCommandIds: ReadonlySet<string> = new Set(metadata.map(({ id }) => id))
