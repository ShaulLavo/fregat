import type { TextareaRenderable } from '@opentui/core'
import { useKeyboard, usePaste, useTerminalDimensions } from '@opentui/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePaneFocus } from '@/commands/hooks/use-pane-focus'
import { useCommandHandlers } from '@/commands/hooks/use-command-handlers'
import { useCommands } from '@/commands/hooks/use-commands'
import { OrbitLoader } from '@/components/orbit-loader'
import type { ComposerDraft } from '@/agent-stage/state/drafts'
import type { Theme } from '@/theme/utils/theme'
import { createPromptEditor } from '@/agent-stage/state/prompt-editor'
import { imagePastePath, largePaste, type PromptElement } from '@/agent-stage/utils/prompt'
import { formatTerminalContextLabel } from '@workspace/client-core/chat/terminal-context'
import { promptSyntax } from '@/agent-stage/utils/syntax'

export function Composer({
  draft,
  theme,
  enabled,
  submitting,
  busy,
  onChange,
  onSubmit,
  onComplete,
  onTyped,
  onPasteFile,
  planReady = false,
}: {
  readonly planReady?: boolean
  readonly draft: ComposerDraft
  readonly theme: Theme
  readonly enabled: boolean
  readonly submitting: boolean
  readonly busy: boolean
  readonly onChange: (text: string, elements?: PromptElement[]) => void
  readonly onSubmit: (text: string) => void
  readonly onComplete: (text: string) => void
  readonly onTyped: () => void
  readonly onPasteFile: (filename: string) => void
}) {
  const { width, height } = useTerminalDimensions()
  const compact = height < 20
  const input = useRef<TextareaRenderable>(null)
  const editor = useRef<ReturnType<typeof createPromptEditor> | null>(null)
  const [syntax] = useState(() => promptSyntax(theme))
  useEffect(() => () => syntax.destroy(), [syntax])
  const focused = usePaneFocus({
    id: 'agent-composer',
    area: 'chat',
    textEntry: true,
    enabled,
  })
  const commands = useCommands()
  useLayoutEffect(() => {
    if (!input.current) return
    editor.current ??= createPromptEditor(input.current, syntax)
    editor.current.sync(draft)
  }, [draft, syntax])
  usePaste((event) => {
    if (!focused || event.defaultPrevented || !editor.current) return
    const text = new TextDecoder().decode(event.bytes)
    const filename = imagePastePath(text)
    if (filename) {
      event.preventDefault()
      onPasteFile(filename)
      return
    }
    if (!largePaste(text)) return
    event.preventDefault()
    const content = editor.current.paste(text)
    onTyped()
    onChange(content.text, content.elements)
  })
  useKeyboard((event) => {
    if (!focused || event.defaultPrevented || event.ctrl || event.meta) return
    if (event.name !== 'tab') return
    if (!/(?:^|\s)[@/$][^\s]*$/.test(input.current?.plainText ?? '')) return
    event.preventDefault()
    onComplete(input.current?.plainText ?? draft.text)
  })
  function publish() {
    const content = editor.current?.read()
    const text = content?.text ?? input.current?.plainText ?? draft.text
    onChange(text, content?.elements)
    editor.current?.decorate()
    return text
  }
  useCommandHandlers(
    {
      'chat.sendMessage': {
        disabledReason: () => (busy || submitting ? 'A response is already running.' : null),
        run: () => onSubmit(publish()),
      },
      'chat.completePrompt': {
        disabledReason: () =>
          focused && /(?:^|\s)[@/$][^\s]*$/.test(input.current?.plainText ?? '')
            ? null
            : 'Type @, /, or $ followed by a token to complete.',
        run: () => onComplete(input.current?.plainText ?? draft.text),
      },
      'chat.focusInput': {
        run: () => {
          commands.focus.request({
            kind: 'match',
            matches: (target) => target.widgetId === 'agent-composer',
          })
        },
      },
      'chat.undoPrompt': {
        run: () => {
          input.current?.undo()
          publish()
        },
      },
      'chat.redoPrompt': {
        run: () => {
          input.current?.redo()
          publish()
        },
      },
    },
    enabled,
  )
  const hint = planReady
    ? 'Enter implement plan · type feedback to refine'
    : 'Enter send · Shift+Enter newline'
  return (
    <box
      flexDirection='column'
      id='agent-composer-surface'
      width='100%'
      border={['left']}
      borderColor={focused ? theme.primary : theme.border}
      backgroundColor={theme.card}
      paddingX={2}
      paddingY={compact ? 0 : 1}
      flexShrink={0}
    >
      <textarea
        id='agent-composer'
        ref={input}
        syntaxStyle={syntax}
        initialValue={draft.text}
        focused={focused}
        height={Math.min(6, Math.max(compact ? 2 : 3, draft.text.split('\n').length + 1))}
        width='100%'
        placeholder={
          busy ? 'Draft your next message while the agent works…' : 'Ask the agent to do something…'
        }
        placeholderColor={theme.mutedForeground}
        textColor={theme.foreground}
        focusedTextColor={theme.foreground}
        backgroundColor={theme.card}
        focusedBackgroundColor={theme.card}
        keyBindings={[
          { name: 'return', action: 'submit' },
          { name: 'return', shift: true, action: 'newline' },
        ]}
        onSubmit={() => {
          if (!busy && !submitting) onSubmit(publish())
        }}
        onContentChange={() => {
          if (editor.current?.synchronizing) return
          onTyped()
          // OpenTUI adjusts extmark ranges after its content event.
          queueMicrotask(() => {
            if (input.current) publish()
          })
        }}
      />
      <box height={1} flexDirection='row' gap={1} overflow='hidden'>
        {submitting && <OrbitLoader theme={theme} />}
        <text fg={theme.mutedForeground}>{submitting ? 'Sending prompt…' : hint}</text>
        {width >= 100 && !planReady && !submitting && (
          <text fg={theme.mutedForeground}>· @ files / commands</text>
        )}
      </box>
      {draft.attachments.length > 0 && (
        <text fg={theme.info}>
          {draft.attachments
            .map((attachment, index) => `[${index + 1}: ${attachment.name}]`)
            .join(' ')}
        </text>
      )}
      {(draft.terminalContexts ?? []).map((context, index) => (
        <text key={`${context.source}:${index}`} fg={theme.info}>
          {`[Terminal: ${formatTerminalContextLabel(context)}]`}
        </text>
      ))}
    </box>
  )
}
