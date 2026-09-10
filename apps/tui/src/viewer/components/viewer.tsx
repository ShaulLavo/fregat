import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react'
import type { ScrollBoxRenderable } from '@opentui/core'
import { useCommands } from '@/commands/hooks/use-commands'
import { useCommandFocus } from '@/commands/hooks/use-command-focus'
import { usePaneFocus } from '@/commands/hooks/use-pane-focus'
import { useCommandHandlers } from '@/commands/hooks/use-command-handlers'
import { commandShortcut } from '@/commands/utils/bindings'
import { Dialog } from '@/components/dialog'
import { Prompt } from '@/components/prompt'
import { LoadingState } from '@/components/loading-state'
import { EmptyState } from '@/components/empty-state'
import { Spinner } from '@/components/spinner'
import type { SettingsSession } from '@/connection/state/session'
import { connectionFailure } from '@/connection/utils/failure'
import type { Theme } from '@/theme/utils/theme'
import { ViewerLine } from '@/viewer/components/line'
import { useViewerDocument } from '@/viewer/hooks/use-document'
import { useViewerLanguage } from '@/viewer/hooks/use-language'
import {
  clampPosition,
  findMatches,
  nextMatch,
  nextCharacter,
  type ViewerPosition,
} from '@/viewer/utils/find'
import type { ViewerDiagnostics } from '@/viewer/utils/lsp'
import { viewerGutterWidth, viewerTextWidth } from '@/viewer/utils/columns'

export function FileViewer({
  session,
  rootPath,
  path,
  line,
  theme,
  enabled,
  onOpenFile,
  onDiagnostics,
  onPositionChange,
}: {
  readonly session: SettingsSession
  readonly rootPath: string
  readonly path: string
  readonly line?: number
  readonly theme: Theme
  readonly enabled: boolean
  readonly onOpenFile: (path: string, line?: number) => void
  readonly onDiagnostics?: (snapshot: ViewerDiagnostics) => void
  readonly onPositionChange?: (line: number) => void
}) {
  const commands = useCommands()
  const renderer = useRenderer()
  const scroll = useRef<ScrollBoxRenderable | null>(null)
  const { document, state } = useViewerDocument(session, rootPath, path)
  const [position, setPosition] = useState<ViewerPosition>({
    line: Math.max(0, (line ?? 1) - 1),
    character: 0,
  })
  const latestPosition = useRef(position)
  const reportedLine = useRef<number | null>(null)
  const paletteKeys = commandShortcut(commands.bindings, 'workspace.showCommandPalette')
  const paletteHint = paletteKeys === 'unassigned' ? 'Command palette' : paletteKeys
  const [prompt, setPrompt] = useState<'find' | 'line' | null>(null)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<ViewerDiagnostics['items']>([])
  const { height, width } = useTerminalDimensions()
  const [top, setTop] = useState(0)
  const [pageSize, setPageSize] = useState(Math.max(1, height - 10))
  const [viewportWidth, setViewportWidth] = useState(width)
  const lines = state.kind === 'ready' ? state.file.content.split('\n') : []
  const matches = state.kind === 'ready' ? findMatches(state.file.content, query) : []
  const { tokens, lsp } = useViewerLanguage({
    session,
    rootPath,
    path,
    state,
    appearance: theme.appearance,
    onDiagnostics: (snapshot) => {
      setDiagnostics(snapshot.items)
      onDiagnostics?.(snapshot)
    },
  })
  const scope = commands.focus.getSnapshot().scope
  const focused = usePaneFocus({ id: 'workbench-viewer', area: 'editor', enabled })
  const active = focused && !prompt && !message
  function restoreFocus() {
    commands.focus.request({
      kind: 'match',
      matches: (target) => target.widgetId === 'workbench-viewer',
    })
  }
  function closePrompt() {
    setPrompt(null)
    restoreFocus()
  }
  function closeMessage() {
    setMessage(null)
    restoreFocus()
  }
  useCommandFocus(
    {
      ...scope,
      id: 'viewer-prompt',
      area: 'editor',
      textEntry: true,
      overlay: true,
      focus: () => Boolean(prompt),
    },
    enabled && Boolean(prompt),
  )
  useCommandFocus(
    {
      ...scope,
      id: 'viewer-message',
      area: 'dialog',
      textEntry: false,
      overlay: true,
      focus: () => Boolean(message),
    },
    enabled && Boolean(message),
  )
  function goTo(next: ViewerPosition) {
    const value = clampPosition(lines, next)
    const previous = latestPosition.current
    latestPosition.current = value
    setPosition(value)
    setTop((current) => {
      if (value.line < current) return value.line
      if (value.line >= current + pageSize) return value.line - pageSize + 1
      return current
    })
    if (value.line === previous.line || !onPositionChange) return
    reportedLine.current = value.line + 1
    onPositionChange(value.line + 1)
  }
  const requestedLine = useRef<{ line: number | undefined } | null>(null)
  const fileVersion = state.kind === 'ready' ? state.file.version : null
  const followColumn = useEffectEvent(() => {
    const viewport = scroll.current
    if (!viewport) return
    const text = lines[position.line] ?? ''
    const prefix = text.slice(0, position.character)
    const column = viewerGutterWidth + viewerTextWidth(prefix, renderer.widthMethod)
    const matched = matches.some(
      (match) => match.line === position.line && match.character === position.character,
    )
    const end = matched
      ? position.character + query.length
      : nextCharacter(text, position.character)
    const targetWidth = Math.max(
      1,
      viewerTextWidth(text.slice(position.character, end), renderer.widthMethod),
    )
    if (column < viewport.scrollLeft) viewport.scrollLeft = column
    else if (column + targetWidth > viewport.scrollLeft + viewport.viewport.width)
      viewport.scrollLeft = Math.min(column, column + targetWidth - viewport.viewport.width)
    if (position.character === 0) viewport.scrollLeft = 0
  })
  useLayoutEffect(() => {
    followColumn()
  }, [position, fileVersion, pageSize, viewportWidth, query])
  const followAddress = useEffectEvent(() => {
    if (state.kind !== 'ready') return
    if (requestedLine.current?.line === line && requestedLine.current) {
      goTo(latestPosition.current)
      return
    }
    requestedLine.current = { line }
    if (reportedLine.current === line) {
      reportedLine.current = null
      goTo(latestPosition.current)
      return
    }
    goTo({ line: Math.max(0, (line ?? 1) - 1), character: 0 })
  })
  useEffect(() => {
    followAddress()
  }, [line, fileVersion])
  function find(direction: 1 | -1) {
    const match = nextMatch(matches, latestPosition.current, direction)
    if (match) goTo(match)
  }
  async function languageAction(kind: 'hover' | 'definition') {
    if (!lsp.current) return
    const position = latestPosition.current
    try {
      if (kind === 'hover') {
        setMessage(await lsp.current.hover(position))
        return
      }
      const targets = await lsp.current.definitions(position)
      if (targets[0]) onOpenFile(targets[0].path, targets[0].line)
      else setMessage('No definition at this position.')
    } catch (error) {
      setMessage(connectionFailure(error).message)
    }
  }
  async function revert() {
    await document.reload()
    restoreFocus()
  }
  useCommandHandlers(
    {
      'editor.find': {
        run: () => {
          setDraft(query)
          setPrompt('find')
        },
      },
      'editor.findNext': { run: () => find(1) },
      'editor.findPrevious': { run: () => find(-1) },
      'editor.closeFind': {
        run: () => {
          setPrompt(null)
          setQuery('')
        },
      },
      'editor.goToDefinition': { run: () => languageAction('definition') },
      'editor.editor.action.showHover': { run: () => languageAction('hover') },
      'workspace.goToLine': {
        run: () => {
          setDraft(String(position.line + 1))
          setPrompt('line')
        },
      },
      'workspace.editFile': { run: () => document.edit() },
      'workspace.revertFile': {
        disabledReason: () =>
          state.kind === 'ready' && state.editing ? 'Finish editing first.' : null,
        run: revert,
      },
    },
    enabled && !prompt && !message,
  )
  useKeyboard((event) => {
    if (!active || event.defaultPrevented || event.ctrl || event.meta) return
    const position = latestPosition.current
    if (event.name === 'up') goTo({ ...position, line: position.line - 1 })
    else if (event.name === 'down') goTo({ ...position, line: position.line + 1 })
    else if (event.name === 'left') goTo({ ...position, character: position.character - 1 })
    else if (event.name === 'right')
      goTo({
        ...position,
        character: nextCharacter(lines[position.line] ?? '', position.character),
      })
    else if (event.name === 'pageup') goTo({ ...position, line: position.line - pageSize })
    else if (event.name === 'pagedown') goTo({ ...position, line: position.line + pageSize })
    else if (event.name === 'home') goTo({ ...position, character: 0 })
    else if (event.name === 'end')
      goTo({ ...position, character: lines[position.line]?.length ?? 0 })
    else return
    event.preventDefault()
  })
  function submit(value: string) {
    if (prompt === 'find') {
      setQuery(value)
      const found = state.kind === 'ready' ? findMatches(state.file.content, value)[0] : undefined
      if (found) goTo(found)
    }
    if (prompt === 'line' && /^\d+$/.test(value)) goTo({ line: Number(value) - 1, character: 0 })
    closePrompt()
  }
  if (state.kind === 'loading') return <LoadingState label={`Reading ${path}…`} theme={theme} />
  if (state.kind === 'failed')
    return <EmptyState title='File could not be opened' description={state.message} theme={theme} />
  return (
    <box flexDirection='column' flexGrow={1} overflow='hidden'>
      <text fg={theme.mutedForeground} height={1}>
        {path} · read only · {position.line + 1}:{position.character + 1} / {lines.length}
        {query ? ` · ${matches.length} matches for ${query}` : ''}
      </text>
      <scrollbox
        id='workbench-viewer'
        ref={scroll}
        focused={active}
        flexGrow={1}
        scrollY={false}
        scrollX
        onSizeChange={function () {
          setPageSize(Math.max(1, this.height))
          setViewportWidth(this.width)
        }}
        onMouseScroll={(event) => {
          if (event.scroll?.direction === 'left' || event.scroll?.direction === 'right') return
          const delta = event.scroll?.direction === 'up' ? -3 : 3
          setTop((current) => Math.max(0, Math.min(lines.length - pageSize, current + delta)))
        }}
      >
        {lines.slice(top, top + pageSize).map((text, index) => (
          <ViewerLine
            key={top + index}
            text={text}
            number={top + index + 1}
            selected={top + index === position.line}
            character={position.character}
            query={query}
            tokens={tokens[top + index]}
            theme={theme}
            diagnostic={diagnostics.some((item) => item.range.start.line === top + index)}
            onSelect={() => goTo({ line: top + index, character: 0 })}
          />
        ))}
      </scrollbox>
      {state.editing && (
        <box flexDirection='row'>
          <Spinner theme={theme} />
          <text fg={theme.foreground}> Editing file…</text>
        </box>
      )}
      {state.error && <text fg={theme.destructive}>{state.error}</text>}
      {state.draft !== null && (
        <text
          fg={theme.warning}
          onMouseDown={() => {
            if (enabled) void revert()
          }}
        >
          Draft kept · {paletteHint} → Revert file to discard and reload
        </text>
      )}
      {prompt && (
        <Dialog
          title={prompt === 'find' ? 'Find in file' : 'Go to line'}
          theme={theme}
          onClose={closePrompt}
        >
          <Prompt
            id='viewer-prompt'
            value={draft}
            onChange={setDraft}
            onSubmit={submit}
            theme={theme}
            focused={enabled}
          />
        </Dialog>
      )}
      {message && (
        <Dialog title='Language information' theme={theme} onClose={closeMessage}>
          <scrollbox
            id='viewer-message'
            focused={enabled}
            height={Math.max(3, Math.min(16, height - 8))}
          >
            <text fg={theme.foreground}>{message}</text>
          </scrollbox>
        </Dialog>
      )}
    </box>
  )
}
