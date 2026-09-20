import { useState } from 'react'
import { useListbox } from '@workspace/ui/patterns/use-listbox'
import type { ChatTurnDiffSummary } from '@workspace/client-core/chat/types'

import { AssistantChangedFileRow } from '@/features/chat/components/assistant-changed-file-row'
import { buildChatTurnDiffTree } from '@/features/chat/utils/turn-diff-tree'
import { collectDirectoryPaths, turnDiffRows } from '@/features/chat/utils/turn-diff-view'

type Expansion = { key: string; overrides: Readonly<Record<string, boolean>> }

export function AssistantChangedFilesTree({
  allDirectoriesExpanded,
  files,
  onOpenFileDiff,
}: {
  allDirectoriesExpanded: boolean
  files: ChatTurnDiffSummary['files']
  onOpenFileDiff?: (path: string) => void
}) {
  const nodes = buildChatTurnDiffTree(files)
  const key = `${allDirectoriesExpanded}\u0000${collectDirectoryPaths(nodes).join('\u0000')}`
  const [expansion, setExpansion] = useState<Expansion>({ key, overrides: {} })
  const [activeId, setActiveId] = useState<string | null>(null)
  const overrides = expansion.key === key ? expansion.overrides : {}
  const rows = turnDiffRows(nodes, allDirectoriesExpanded, overrides)

  function toggle(path: string) {
    setExpansion((current) => {
      const currentOverrides = current.key === key ? current.overrides : {}
      return {
        key,
        overrides: {
          ...currentOverrides,
          [path]: !(currentOverrides[path] ?? allDirectoriesExpanded),
        },
      }
    })
  }
  function activate(path: string) {
    const row = rows.find((entry) => entry.id === path)
    if (row?.hasChildren) return toggle(path)
    onOpenFileDiff?.(path)
  }
  const list = useListbox({
    role: 'tree',
    items: rows,
    activeId,
    onActiveChange: setActiveId,
    onCommit: activate,
    onCollapse: toggle,
    onExpand: toggle,
  })
  return (
    <div {...list.containerProps} aria-label='Changed files' className='focus-ring-inset'>
      {rows.map((row) => (
        <AssistantChangedFileRow
          key={row.id}
          row={row}
          rowProps={list.rowProps(row.id)}
          onActivate={() => activate(row.id)}
        />
      ))}
    </div>
  )
}
