import { useState } from 'react'
import { createCheckpointRevertCommand } from '@workspace/client-core/chat/commands'
import type { ChatSession } from '@workspace/client-core/chat/types'
import type { ClientOrchestrationCommand } from '@workspace/contracts'
import { useAgentNavigation } from '@/navigation/hooks/use-agent-navigation'
import { useCommandFocus } from '@/commands/hooks/use-command-focus'
import { useCommands } from '@/commands/hooks/use-commands'
import { Dialog } from '@/components/dialog'
import { Select } from '@/components/select'
import { Prompt } from '@/components/prompt'
import { OrbitLoader } from '@/components/orbit-loader'
import { connectionFailure } from '@/connection/utils/failure'
import type { Theme } from '@/theme/utils/theme'

export function ChangedFiles({
  conversation,
  theme,
  onClose,
  run,
  revert,
}: {
  readonly conversation: ChatSession
  readonly theme: Theme
  readonly onClose: () => void
  readonly run: (command: ClientOrchestrationCommand) => Promise<boolean>
  readonly revert: boolean
}) {
  const commands = useCommands()
  const navigation = useAgentNavigation()
  const [selectedTurn, setSelectedTurn] = useState<number | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const id = selectedTurn === null ? 'agent-changed-files' : 'agent-revert-confirmation'
  useCommandFocus(
    {
      ...commands.focus.getSnapshot().scope,
      id,
      area: 'dialog',
      textEntry: selectedTurn !== null,
      overlay: true,
      focus: () => true,
    },
    true,
  )
  const files = conversation.turnDiffSummaries.flatMap((turn) =>
    turn.files.map((file) => ({ file, turn })),
  )
  const options = revert
    ? conversation.turnDiffSummaries.map((turn) => ({
        name: `Before turn ${turn.checkpointTurnCount}`,
        description: `${turn.files.length} changed files · ${turn.status}`,
        value: turn.checkpointTurnCount - 1,
      }))
    : files.map(({ file, turn }) => ({
        name: file.path,
        description: `Turn ${turn.checkpointTurnCount} · +${file.additions} −${file.deletions}`,
        value: file.path,
      }))
  async function confirm(value: string) {
    if (value !== 'revert' || selectedTurn === null || busy) return
    setBusy(true)
    try {
      if (
        await run(
          createCheckpointRevertCommand({ sessionId: conversation.id, turnCount: selectedTurn }),
        )
      )
        onClose()
    } finally {
      setBusy(false)
    }
  }
  async function openFile(index: number) {
    if (busy) return
    const entry = files[index]
    if (!entry) return
    setBusy(true)
    setError('')
    try {
      await navigation.openFile({
        rootPath: conversation.worktree.path,
        relativePath: entry.file.path,
      })
      onClose()
    } catch (failure) {
      setError(connectionFailure(failure).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={revert ? 'Revert to checkpoint' : 'Files changed by this session'}
      theme={theme}
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      {options.length === 0 && (
        <scrollbox id={id} focused height={2}>
          <text fg={theme.mutedForeground}>No file checkpoints in this session.</text>
        </scrollbox>
      )}
      {selectedTurn === null && options.length > 0 && (
        <Select
          id={id}
          options={options}
          focused
          showDescription
          height={Math.min(16, options.length * 2)}
          textColor={theme.foreground}
          selectedTextColor={theme.primaryForeground}
          selectedBackgroundColor={theme.primary}
          onSelect={(index) => {
            if (busy) return
            if (revert) {
              const turn = conversation.turnDiffSummaries[index]
              if (turn?.status === 'ready') setSelectedTurn(turn.checkpointTurnCount - 1)
              return
            }
            void openFile(index)
          }}
        />
      )}
      {busy && selectedTurn === null && <OrbitLoader theme={theme} />}
      {error && <text fg={theme.destructive}>{error}</text>}
      {selectedTurn !== null && (
        <box flexDirection='column'>
          <text fg={theme.warning}>
            This restores tracked files and removes later conversation turns. Type revert to
            continue.
          </text>
          <Prompt
            id={id}
            value={confirmation}
            onChange={setConfirmation}
            onSubmit={(value) => {
              void confirm(value)
            }}
            theme={theme}
            disabled={busy}
          />
          {busy && <OrbitLoader theme={theme} />}
        </box>
      )}
    </Dialog>
  )
}
