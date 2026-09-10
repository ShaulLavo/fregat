import { useRef, useState } from 'react'
import { useTerminalDimensions } from '@opentui/react'
import { useCommandFocus } from '@/commands/hooks/use-command-focus'
import { useCommandHandlers } from '@/commands/hooks/use-command-handlers'
import { useCommands } from '@/commands/hooks/use-commands'
import { commandShortcut } from '@/commands/utils/bindings'
import { Dialog } from '@/components/dialog'
import { TextPrompt } from '@/components/text-prompt'
import type { EditTextRequest } from '@/host/providers/actions-context'
import type { Theme } from '@/theme/utils/theme'

export function TextEditor({
  request,
  theme,
  onComplete,
}: {
  request: EditTextRequest
  theme: Theme
  onComplete: (text: string | null) => void
}) {
  const [text, setText] = useState(request.text)
  const draft = useRef(text)
  const commands = useCommands()
  const { width, height } = useTerminalDimensions()
  useCommandFocus(
    {
      ...commands.focus.getSnapshot().scope,
      id: 'text-editor',
      area: 'dialog',
      overlay: true,
      textEntry: true,
      focus: () => true,
    },
    true,
  )
  useCommandHandlers({
    'dialog.confirm': { run: () => onComplete(draft.current) },
  })
  return (
    <Dialog
      title={`Edit ${request.filename ?? 'settings.json'}`}
      theme={theme}
      width={width - 4}
      onClose={() => onComplete(null)}
      footer={`${commandShortcut(commands.bindings, 'dialog.confirm')} save`}
    >
      <TextPrompt
        id='text-editor'
        value={text}
        onChange={(value) => {
          draft.current = value
          setText(value)
        }}
        onSubmit={onComplete}
        theme={theme}
        height={Math.max(1, height - 10)}
        language={!request.filename || request.filename.endsWith('.json') ? 'json' : undefined}
      />
    </Dialog>
  )
}
