import { GitToolPane } from '@/features/chat-mode/components/git-tool-pane'
import { useSessionToolRoot } from '@/features/chat-mode/hooks/use-session-tool-root'
import type { ScreenProps } from '@/features/phone/utils/screen-query'
import { BranchChip } from '@/features/git/components/branch-chip'
import { RemoteActions } from '@/features/git/components/remote-actions'
import { Header } from '@/features/phone/components/header'

/** The session's changed files, by turn or working tree, with the branch's commit and PR state. */
export function ChangesScreen({ diffScope }: ScreenProps) {
  const toolRoot = useSessionToolRoot()

  return (
    <GitToolPane
      diffScope={diffScope}
      header={
        <Header
          actions={<RemoteActions rootPath={toolRoot} />}
          detail={<BranchChip rootPath={toolRoot} />}
          title='Changes'
        />
      }
      rootPath={toolRoot}
    />
  )
}
