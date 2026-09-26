import { use } from 'react'

import { ComposerAttachContext } from '@/lib/composer-attach/providers/context'
import { useEnvironmentId } from '@/lib/environments/hooks/use-environment-id'
import { clientErrors } from '@/lib/structured-errors'

/** The attach actions for a capture surface in the workspace at `rootPath`. */
export function useAttachToComposer(rootPath: string) {
  const attach = use(ComposerAttachContext)
  if (!attach)
    throw clientErrors.CONTEXT_MISSING({
      message: 'useAttachToComposer must be used within ComposerAttachProvider',
    })
  const environmentId = useEnvironmentId()

  const destination = { environmentId, rootPath }
  return {
    appendText: (source: string, text: string) => attach.appendText(source, text, destination),
    attachText: (source: string, text: string) => attach.attachText(source, text, destination),
    attachTerminalContext: (selection: Parameters<typeof attach.attachTerminalContext>[0]) =>
      attach.attachTerminalContext(selection, destination),
    attachTextToNewChat: (source: string, text: string) =>
      attach.attachTextToNewChat(source, text, destination),
  }
}
