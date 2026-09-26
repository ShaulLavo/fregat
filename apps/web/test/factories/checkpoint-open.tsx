import type { ChatTurnDiffSummary } from '@workspace/client-core/chat/types'
import { TurnFiles } from '@/features/chat-mode/components/turn-files'
import { useOpenCheckpointDiffDocument } from '@/features/chat/hooks/use-open-checkpoint-diff-document'

export function CheckpointOpen({
  summary,
  visible,
  onOpen,
}: {
  summary: ChatTurnDiffSummary
  visible: boolean
  onOpen: (result: Promise<boolean>) => void
}) {
  const { openCheckpointDiff } = useOpenCheckpointDiffDocument()
  return visible ? (
    <TurnFiles
      rootPath=''
      summary={summary}
      onOpenFile={(path) => onOpen(openCheckpointDiff(summary, path))}
    />
  ) : null
}
