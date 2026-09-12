import { useEffect, useState } from 'react'
import type { Client } from '@workspace/client-core/transport/client'
import type { WorkspaceSearchMatch, WorkspaceSearchQuery } from '@workspace/contracts'
import { recordObservabilityInfo } from '@workspace/observability'
import { useCommandFocus } from '@/commands/hooks/use-command-focus'
import { useCommands } from '@/commands/hooks/use-commands'
import { Dialog } from '@/components/dialog'
import { Prompt } from '@/components/prompt'
import { LoadingState } from '@/components/loading-state'
import { connectionFailure } from '@/connection/utils/failure'
import {
  prepareReplacement,
  applyReplacement,
  type ReplacementPlan,
} from '@/search/state/replacement'
import type { Theme } from '@/theme/utils/theme'

type Phase =
  | { kind: 'editing' }
  | { kind: 'preparing' }
  | { kind: 'preview'; plan: ReplacementPlan }
  | { kind: 'applying'; plan: ReplacementPlan }
export function ReplaceDialog({
  client,
  query,
  matches,
  searchKind,
  searchTruncated,
  theme,
  onClose,
  onApplied,
}: {
  client: Client
  query: WorkspaceSearchQuery
  matches: readonly WorkspaceSearchMatch[]
  searchKind: 'empty' | 'loading' | 'ready' | 'failed'
  searchTruncated: boolean
  theme: Theme
  onClose: () => void
  onApplied: () => void
}) {
  const [replacement, setReplacement] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'editing' })
  const [message, setMessage] = useState('')
  const [lifetime] = useState(() => new AbortController())
  const commands = useCommands()
  useEffect(() => () => lifetime.abort(), [lifetime])
  useCommandFocus(
    {
      ...commands.focus.getSnapshot().scope,
      id: 'search-replace-input',
      area: 'dialog',
      textEntry: true,
      overlay: true,
      focus: () => true,
    },
    true,
  )
  const busy = phase.kind === 'preparing' || phase.kind === 'applying'
  async function submit(value: string) {
    setMessage('')
    try {
      if (phase.kind === 'editing') {
        setPhase({ kind: 'preparing' })
        const plan = await prepareReplacement({
          client,
          query,
          matches,
          replacement: value,
          signal: lifetime.signal,
        })
        if (!lifetime.signal.aborted) setPhase({ kind: 'preview', plan })
        return
      }
      if (phase.kind !== 'preview' || value !== 'replace' || !phase.plan.operations.length) return
      setPhase({ kind: 'applying', plan: phase.plan })
      await applyReplacement(client, query.path, phase.plan, lifetime.signal)
      // `searchKind`/`searchTruncated` are what the enabling gate saw. Constant
      // today, so a regression in that gate shows up here.
      recordObservabilityInfo('tui.search.replace', {
        area: 'search',
        matchCount: matches.length,
        operationCount: phase.plan.operations.length,
        outcome: 'applied',
        path: query.path,
        replacedCount: phase.plan.count,
        searchKind,
        searchTruncated,
      })
      if (!lifetime.signal.aborted) onApplied()
    } catch (error) {
      if (lifetime.signal.aborted) return
      setMessage(connectionFailure(error).message)
      setPhase({ kind: 'editing' })
    }
  }
  const preview = phase.kind === 'preview' || phase.kind === 'applying'
  return (
    <Dialog
      title='Replace workspace matches'
      theme={theme}
      onClose={() => {
        if (!busy) onClose()
      }}
      width={100}
      height={25}
    >
      <text fg={theme.mutedForeground}>
        {preview
          ? 'Review the resulting files. Type replace to apply them together.'
          : `Replace ${JSON.stringify(query.query)} with the text below. Empty text deletes matches.`}
      </text>
      <Prompt
        id='search-replace-input'
        value={preview ? confirmation : replacement}
        onChange={preview ? setConfirmation : setReplacement}
        onSubmit={(value) => {
          void submit(value)
        }}
        theme={theme}
        disabled={busy}
      />
      {busy && (
        <LoadingState
          theme={theme}
          label={phase.kind === 'preparing' ? 'Preparing replacement…' : 'Applying replacement…'}
        />
      )}
      {preview && (
        <text fg={theme.info}>
          {phase.plan.count} matches in {phase.plan.operations.length} files
        </text>
      )}
      {preview && (
        <scrollbox flexGrow={1} minHeight={0}>
          {phase.plan.operations.map((operation) => (
            <box key={operation.index} flexDirection='column'>
              <text fg={theme.primary}>{'path' in operation ? operation.path : ''}</text>
              {operation.kind === 'write' && <text fg={theme.foreground}>{operation.text}</text>}
            </box>
          ))}
        </scrollbox>
      )}
      {message && <text fg={theme.destructive}>{message}</text>}
    </Dialog>
  )
}
