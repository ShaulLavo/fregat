import { useRef, useState } from 'react'
import type {
  OrchestrationProjectShell,
  OrchestrationWorktreeShell,
  WorktreeId,
} from '@workspace/contracts'
import { useCommandFocus } from '@/commands/hooks/use-command-focus'
import { useCommands } from '@/commands/hooks/use-commands'
import { Dialog } from '@/components/dialog'
import { Prompt } from '@/components/prompt'
import { Select } from '@/components/select'
import { EmptyState } from '@/components/empty-state'
import type { Theme } from '@/theme/utils/theme'
import { selectableWorktree, worktreeChoices } from '@/worktrees/utils/choices'

export function WorktreePicker({
  worktrees,
  project,
  value,
  theme,
  onSelect,
  onClose,
}: {
  readonly worktrees: readonly OrchestrationWorktreeShell[]
  readonly project: OrchestrationProjectShell
  readonly value: WorktreeId
  readonly theme: Theme
  readonly onSelect: (id: WorktreeId) => void
  readonly onClose: () => void
}) {
  const commands = useCommands()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const selection = useRef(0)
  const [message, setMessage] = useState<string | null>(null)
  const choices = worktreeChoices({ worktrees, project, value, query })
  useCommandFocus(
    {
      ...commands.focus.getSnapshot().scope,
      id: 'worktree-picker-filter',
      area: 'dialog',
      textEntry: true,
      overlay: true,
      focus: () => true,
    },
    true,
  )
  function select(index = selection.current, submittedQuery = query) {
    const options = worktreeChoices({ worktrees, project, value, query: submittedQuery })
    const worktree = options[index]?.value
    if (!worktree) return
    if (!selectableWorktree(worktree)) {
      setMessage('This checkout is not ready. Open Worktrees to retry or recover it.')
      return
    }
    onSelect(worktree.id)
  }
  function updateSelection(index: number) {
    selection.current = index
    setSelected(index)
  }
  return (
    <Dialog title='Choose checkout' theme={theme} width={90} height={23} onClose={onClose}>
      <Prompt
        id='worktree-picker-filter'
        value={query}
        onChange={(text) => {
          setQuery(text)
          updateSelection(0)
          setMessage(null)
        }}
        onSubmit={(text) => select(selection.current, text)}
        theme={theme}
        placeholder='Filter branches or checkout paths…'
      />
      <Select
        options={choices}
        selectedIndex={selected}
        onChange={updateSelection}
        onSelect={(index) => select(index)}
        navigateFromInput
        flexGrow={1}
        minHeight={0}
        textColor={theme.foreground}
        selectedTextColor={theme.primary}
        selectedBackgroundColor={theme.accent}
      />
      {choices.length === 0 && <EmptyState title='No matching checkouts' theme={theme} />}
      {message && <text fg={theme.warning}>{message}</text>}
    </Dialog>
  )
}
