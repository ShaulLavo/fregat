import { useEffect, useState, useSyncExternalStore } from 'react'
import { useKeyboard, useTerminalDimensions } from '@opentui/react'
import { useCommands } from '@/commands/hooks/use-commands'
import { useCommandFocus } from '@/commands/hooks/use-command-focus'
import { usePaneFocus } from '@/commands/hooks/use-pane-focus'
import { useCommandHandlers } from '@/commands/hooks/use-command-handlers'
import { Dialog } from '@/components/dialog'
import { Prompt } from '@/components/prompt'
import { LoadingState } from '@/components/loading-state'
import { EmptyState } from '@/components/empty-state'
import { OrbitLoader } from '@/components/orbit-loader'
import { createWorkbenchTree } from '@/tree/state/tree'
import { treeRowIcon } from '@/tree/utils/paths'
import type { SettingsSession } from '@/connection/state/session'
import { connectionFailure } from '@/connection/utils/failure'
import type { Theme } from '@/theme/utils/theme'

type TreePrompt = {
  readonly kind: 'file' | 'folder' | 'rename' | 'delete' | 'filter'
  readonly path: string
}

export function FileTree({
  session,
  rootPath,
  theme,
  enabled,
  onOpenFile,
}: {
  readonly session: SettingsSession
  readonly rootPath: string
  readonly theme: Theme
  readonly enabled: boolean
  readonly onOpenFile: (path: string, line?: number) => void
}) {
  const commands = useCommands()
  const [tree] = useState(() => createWorkbenchTree(session, rootPath))
  useSyncExternalStore(tree.subscribe, tree.getSnapshot)
  const [prompt, setPrompt] = useState<TreePrompt | null>(null)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { height } = useTerminalDimensions()
  const scope = commands.focus.getSnapshot().scope
  const controller = tree.controller
  const status = tree.getStatus()
  const focused = usePaneFocus({ id: 'workbench-file-tree', area: 'file-tree', enabled })
  const active = focused && prompt === null
  const [pageSize, setPageSize] = useState(Math.max(1, height - 8))
  const start = Math.max(0, controller.getFocusedIndex() - pageSize + 1)
  const rows = controller.getVisibleRows(start, start + pageSize)
  function closePrompt() {
    setPrompt(null)
    commands.focus.request({
      kind: 'match',
      matches: (target) => target.widgetId === 'workbench-file-tree',
    })
  }
  useCommandFocus(
    {
      ...scope,
      id: 'file-tree-prompt',
      area: 'file-tree',
      textEntry: true,
      overlay: true,
      focus: () => Boolean(prompt),
    },
    enabled && Boolean(prompt),
  )
  useEffect(() => {
    const state = session.getSnapshot()
    if (state.kind !== 'ready') return
    const update = () => tree.setShowHidden(state.owner.readSettingsMirror()['files.showHidden'])
    update()
    const unsubscribe = state.owner.subscribe(update)
    return () => {
      unsubscribe()
    }
  }, [session, tree])
  useEffect(() => {
    void tree.refresh()
    return () => tree.dispose()
  }, [tree])
  function show(kind: TreePrompt['kind']) {
    const path = controller.getFocusedPath() ?? ''
    if (!path && (kind === 'rename' || kind === 'delete')) return
    setValue(kind === 'rename' ? (path.replace(/\/$/, '').split('/').at(-1) ?? '') : '')
    setError(null)
    setPrompt({ kind, path })
  }
  async function open() {
    const path = controller.getFocusedPath()
    if (!path) return
    const file = await tree.open(path)
    if (file) onOpenFile(file)
  }
  useCommandHandlers(
    {
      'fileTree.newFile': { run: () => show('file') },
      'fileTree.newFolder': { run: () => show('folder') },
      'fileTree.rename': { run: () => show('rename') },
      'fileTree.delete': { run: () => show('delete') },
      'fileTree.refresh': { run: () => tree.refresh() },
      'workspace.findInFileTree': { run: () => show('filter') },
    },
    enabled && !prompt,
  )
  useKeyboard((event) => {
    if (!active || event.defaultPrevented || event.ctrl || event.meta) return
    if (event.name === 'up') controller.focusPreviousItem()
    else if (event.name === 'down') controller.focusNextItem()
    else if (event.name === 'home') controller.focusFirstItem()
    else if (event.name === 'end') controller.focusLastItem()
    else if (event.name === 'return' || event.name === 'right') void open()
    else if (event.name === 'left') {
      const item = controller.getFocusedItem()
      if (item && 'isExpanded' in item && item.isExpanded()) item.collapse()
      else controller.focusParentItem()
    } else return
    event.preventDefault()
  })
  async function submit(next: string) {
    if (!prompt || saving) return
    if (prompt.kind === 'filter') {
      controller.setSearch(next || null)
      closePrompt()
      return
    }
    if (prompt.kind === 'delete' && next !== 'delete') {
      setError('Type delete to confirm.')
      return
    }
    if (
      prompt.kind !== 'delete' &&
      (!next.trim() || next.includes('/') || next === '.' || next === '..')
    ) {
      setError('Enter one file or folder name.')
      return
    }
    setSaving(true)
    try {
      const destination = await tree.mutate(prompt.kind, prompt.path, next)
      if (prompt.kind === 'file') onOpenFile(destination)
      closePrompt()
    } catch (caught) {
      setError(connectionFailure(caught).message)
    } finally {
      setSaving(false)
    }
  }
  if (!status.initialized && status.pending)
    return <LoadingState label='Reading files…' theme={theme} />
  return (
    <box flexDirection='column' flexGrow={1} overflow='hidden'>
      <box height={1} flexDirection='row'>
        <text fg={theme.foreground}>
          Files {controller.getSearchValue() ? `· ${controller.getSearchValue()}` : ''}
        </text>
        {status.pending && <OrbitLoader theme={theme} />}
      </box>
      {status.error && <text fg={theme.destructive}>{status.error}</text>}
      {!rows.length && (
        <EmptyState
          title='No files'
          description={
            controller.getSearchValue() ? 'No loaded paths match this filter.' : rootPath || '/'
          }
          theme={theme}
        />
      )}
      <scrollbox
        id='workbench-file-tree'
        focused={active}
        flexGrow={1}
        scrollY={false}
        onSizeChange={function () {
          setPageSize(Math.max(1, this.height))
        }}
      >
        {rows.map((row) => (
          <text
            key={row.path}
            height={1}
            wrapMode='none'
            fg={theme.foreground}
            bg={row.isFocused ? theme.accent : theme.background}
            onMouseDown={() => {
              controller.focusPath(row.path)
              void open()
            }}
          >
            {'  '.repeat(row.depth)}
            {treeRowIcon(row.kind, row.isExpanded, tree.isSymlink(row.path))}
            {row.name}
            {tree.getGitStatus(row.path)
              ? ` ${tree.getGitStatus(row.path)?.slice(0, 1).toUpperCase()}`
              : ''}
          </text>
        ))}
      </scrollbox>
      {prompt && (
        <Dialog
          title={
            prompt.kind === 'delete'
              ? `Delete ${prompt.path}?`
              : `${prompt.kind} · ${prompt.path || rootPath}`
          }
          theme={theme}
          onClose={() => {
            if (!saving) closePrompt()
          }}
        >
          {prompt.kind === 'delete' && (
            <text fg={theme.warning}>
              Type delete to remove this entry. Nonempty folders are refused.
            </text>
          )}
          <Prompt
            id='file-tree-prompt'
            value={value}
            onChange={setValue}
            onSubmit={(next) => {
              void submit(next)
            }}
            theme={theme}
            focused={enabled}
            disabled={saving}
          />
          {error && <text fg={theme.destructive}>{error}</text>}
        </Dialog>
      )}
    </box>
  )
}
