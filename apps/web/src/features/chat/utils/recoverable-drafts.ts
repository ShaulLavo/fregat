import type { EnvironmentId } from '@workspace/contracts'
import type { ChatInputDraft, ChatInputDraftTarget } from '../state/chat-input-draft-store'
import type { DraftIdentity } from './draft-storage'

export type RecoverableDraftRow = {
  key: string
  target: ChatInputDraftTarget
  identity: DraftIdentity
  label: string
}
export function meaningfulDraft(draft: ChatInputDraft) {
  return (
    draft.prompt.trim().length > 0 ||
    draft.attachments.length > 0 ||
    draft.terminalContexts.length > 0
  )
}
export function recoverableDraftRows(
  drafts: Readonly<Record<string, ChatInputDraft>>,
  owners: readonly EnvironmentId[],
): RecoverableDraftRow[] {
  return Object.entries(drafts).flatMap(([key, draft]) => {
    const identity = draft.identity
    const environmentId = owners.find((owner) => key.startsWith(`${owner}:`))
    if (!identity || !environmentId || !meaningfulDraft(draft)) return []
    return [
      {
        key,
        identity,
        target: { environmentId, rootPath: identity.rootPath, draftKey: identity.id },
        label:
          draft.prompt.trim() ||
          draft.attachments.map((item) => item.name).join(', ') ||
          'Terminal context',
      },
    ]
  })
}
