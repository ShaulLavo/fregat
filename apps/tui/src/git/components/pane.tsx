import { useEffect, useState, useSyncExternalStore } from 'react'
import { useCommands } from '@/commands/hooks/use-commands'
import { usePaneFocus } from '@/commands/hooks/use-pane-focus'
import { useCommandFocus } from '@/commands/hooks/use-command-focus'
import { useCommandHandlers } from '@/commands/hooks/use-command-handlers'
import { Dialog } from '@/components/dialog'
import { Prompt } from '@/components/prompt'
import { Select } from '@/components/select'
import { LoadingState } from '@/components/loading-state'
import { EmptyState } from '@/components/empty-state'
import { OrbitLoader } from '@/components/orbit-loader'
import type { WorkbenchPaneProps } from '@/workbench/utils/pane-props'
import { createGitWorkbench } from '@/git/state/workbench'
import { actionLabels, actionTitles, type GitDialog } from '@/git/utils/actions'
import { gitRows } from '@/git/utils/rows'
import { DiffView } from '@/git/components/diff'

export function GitPane({ session, rootPath, theme, enabled, onOpenFile }: WorkbenchPaneProps) {
  const commands = useCommands()
  const [store] = useState(() => createGitWorkbench(session.client, rootPath))
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const connection = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const [selection, setSelected] = useState(0)
  const [dialog, setDialog] = useState<GitDialog | null>(null)
  const [message, setMessage] = useState('')
  const rows = state.listing.kind === 'ready' ? gitRows(state.listing.data.files) : []
  const selected = Math.min(selection, Math.max(0, rows.length - 1))
  const row = rows[selected]?.value
  const selectedPath = row?.file.path
  const staged = row?.staged ?? false
  const scope = {
    screen: 'workbench',
    environmentId: connection.kind === 'ready' ? connection.descriptor.environmentId : '',
    projectId: rootPath,
  }
  const focused = usePaneFocus({ id: 'workbench-git', area: 'git', enabled: enabled && !dialog })
  useCommandFocus(
    {
      ...scope,
      id: 'git-action-input',
      area: 'dialog',
      textEntry: true,
      overlay: true,
      focus: () => dialog !== null,
    },
    enabled && dialog !== null,
  )
  useEffect(() => {
    void store.refresh()
    return () => store.dispose()
  }, [store])
  useEffect(() => {
    if (selectedPath) void store.openDiff(selectedPath, staged)
  }, [store, selectedPath, staged, state.listing])

  function move(amount: number) {
    setSelected((value) => Math.max(0, Math.min(rows.length - 1, value + amount)))
  }
  function showDialog(kind: GitDialog) {
    setMessage('')
    setDialog(kind)
  }
  function closeDialog() {
    setDialog(null)
    commands.focus.request({
      kind: 'match',
      matches: (target) => target.widgetId === 'workbench-git',
    })
  }
  async function submit(value: string) {
    if (dialog === 'pull-request' && (await store.createPullRequest(value))) closeDialog()
    if (dialog === 'commit' && (await store.commit(value))) closeDialog()
    if (
      dialog === 'discard' &&
      selectedPath &&
      value === 'discard' &&
      (await store.discard(selectedPath))
    )
      closeDialog()
  }
  useCommandHandlers(
    {
      'git.generateCommitMessage': {
        run: async () => {
          showDialog('commit')
          const generated = await store.generateMessage()
          if (generated !== null) setMessage(generated)
        },
      },
      'git.createPullRequest': { run: () => showDialog('pull-request') },
      'git.next': { run: () => move(1) },
      'git.previous': { run: () => move(-1) },
      'git.open': {
        run: () => {
          if (selectedPath) onOpenFile(selectedPath)
        },
      },
      'git.stage': {
        disabledReason: () => (!selectedPath || staged ? 'Choose an unstaged file.' : null),
        run: () => {
          if (selectedPath) return store.stage(selectedPath)
        },
      },
      'git.unstage': {
        disabledReason: () => (!selectedPath || !staged ? 'Choose a staged file.' : null),
        run: () => {
          if (selectedPath) return store.unstage(selectedPath)
        },
      },
      'git.commit': {
        disabledReason: () =>
          !rows.some((item) => item.value.staged) ? 'Stage changes before committing.' : null,
        run: () => showDialog('commit'),
      },
      'git.discard': {
        disabledReason: () => (!selectedPath || staged ? 'Choose an unstaged file.' : null),
        run: () => showDialog('discard'),
      },
      'git.refresh': { run: store.refresh },
      'git.fetch': { run: store.fetch },
      'git.pull': { run: store.pull },
      'git.push': { run: store.push },
    },
    enabled && !dialog && !state.busy,
  )
  const repository = state.listing.kind === 'ready' ? state.listing.data.repository : null
  const file = state.diff.kind === 'ready' ? state.diff.files[0] : null
  return (
    <box flexGrow={1} minHeight={0} flexDirection='column'>
      <scrollbox
        id='workbench-git'
        focused={focused && !dialog}
        scrollY={false}
        flexShrink={0}
        maxHeight={12}
      >
        <text fg={theme.primary} height={1}>
          Git
          {repository
            ? ` · ${repository.branch ?? 'detached'} · ↑${repository.ahead} ↓${repository.behind}`
            : ''}
        </text>
        {state.listing.kind === 'loading' && (
          <LoadingState theme={theme} label='Reading Git status…' />
        )}
        {state.listing.kind === 'failed' && (
          <text fg={theme.destructive}>{state.listing.message}</text>
        )}
        {state.listing.kind === 'ready' && !repository && (
          <EmptyState
            theme={theme}
            title='No Git repository'
            description='Open a folder containing a Git repository.'
          />
        )}
        {state.listing.kind === 'ready' && repository && rows.length === 0 && (
          <EmptyState
            theme={theme}
            title='Working tree clean'
            description='File changes will appear here.'
          />
        )}
        {rows.length > 0 && (
          <Select
            id='git-changes'
            options={rows}
            selectedIndex={selected}
            onChange={setSelected}
            onSelect={(index) => {
              const path = rows[index]?.value.file.path
              if (path) onOpenFile(path)
            }}
            focused={focused && !dialog}
            height={Math.min(8, rows.length * 2 + 1)}
            textColor={theme.foreground}
            selectedTextColor={theme.primary}
            selectedBackgroundColor={theme.accent}
          />
        )}
      </scrollbox>
      {state.diff.kind === 'loading' && <LoadingState theme={theme} label='Reading diff…' />}
      {state.diff.kind === 'failed' && <text fg={theme.destructive}>{state.diff.message}</text>}
      {state.diff.kind === 'ready' && !file && rows.length > 0 && (
        <EmptyState
          theme={theme}
          title='No text diff'
          description='This file has no displayable text changes.'
        />
      )}
      {file && (
        <DiffView
          file={file}
          theme={theme}
          enabled={enabled && !dialog}
          owner={connection.kind === 'ready' ? connection.owner : null}
        />
      )}
      {state.busy && (
        <box flexDirection='row'>
          <OrbitLoader theme={theme} />
          <text fg={theme.mutedForeground}> Git operation running…</text>
        </box>
      )}
      {state.message && <text fg={theme.info}>{state.message}</text>}
      {dialog && (
        <Dialog
          title={actionTitles[dialog]}
          theme={theme}
          onClose={() => {
            if (!state.busy) closeDialog()
          }}
          footer='Enter confirm'
        >
          <text fg={theme.mutedForeground}>
            {actionLabels[dialog]}
            {dialog === 'discard' ? ` ${selectedPath}` : ''}
          </text>
          <Prompt
            id='git-action-input'
            value={message}
            onChange={setMessage}
            onSubmit={(value) => {
              void submit(value)
            }}
            focused={enabled}
            disabled={state.busy}
            theme={theme}
          />
          {state.busy && (
            <box flexDirection='row'>
              <OrbitLoader theme={theme} />
              <text fg={theme.mutedForeground}> Working…</text>
            </box>
          )}
          {state.progress && (
            <text fg={theme.mutedForeground}>
              {state.progress.split('\n').slice(-6).join('\n')}
            </text>
          )}
          {state.message && <text fg={theme.info}>{state.message}</text>}
        </Dialog>
      )}
    </box>
  )
}
