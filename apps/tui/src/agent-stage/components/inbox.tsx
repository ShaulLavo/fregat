import { useState } from 'react'
import { formatTerminalContextLabel } from '@workspace/client-core/chat/terminal-context'
import { useCommands } from '@/commands/hooks/use-commands'
import { useCommandFocus } from '@/commands/hooks/use-command-focus'
import { Dialog } from '@/components/dialog'
import { Select } from '@/components/select'
import type { ComposerDraft } from '@/agent-stage/state/drafts'
import { removePromptElement } from '@/agent-stage/utils/prompt'
import type { Theme } from '@/theme/utils/theme'

export function PromptInbox({
  draft,
  theme,
  onChange,
  onClose,
}: {
  readonly draft: ComposerDraft
  readonly theme: Theme
  readonly onChange: (change: Partial<ComposerDraft>) => void
  readonly onClose: () => void
}) {
  const { focus } = useCommands()
  const [selected, setSelected] = useState(0)
  const items = [
    ...(draft.terminalContexts ?? []).map((context, index) => ({
      name: `Terminal: ${formatTerminalContextLabel(context)}`,
      description: context.text,
      remove: () =>
        onChange({ terminalContexts: draft.terminalContexts?.filter((_, item) => item !== index) }),
    })),
    ...(draft.elements ?? []).map((element) => ({
      name: element.label,
      description: element.text,
      remove: () => onChange(removePromptElement(draft, element)),
    })),
    ...draft.attachments.map((attachment) => ({
      name: `Image: ${attachment.name}`,
      description: `${attachment.mimeType} · ${attachment.sizeBytes} bytes`,
      remove: () =>
        onChange({ attachments: draft.attachments.filter((item) => item.id !== attachment.id) }),
    })),
  ]
  useCommandFocus(
    {
      ...focus.getSnapshot().scope,
      id: items.length === 0 ? 'agent-prompt-inbox' : 'agent-prompt-items',
      area: 'dialog',
      textEntry: false,
      overlay: true,
      focus: () => true,
    },
    true,
  )
  return (
    <Dialog
      title='Prompt inbox'
      theme={theme}
      onClose={onClose}
      footer='↑↓ inspect · Enter remove · Escape close'
    >
      <scrollbox id='agent-prompt-inbox' focused={items.length === 0} height={18}>
        {items.length === 0 && (
          <text fg={theme.mutedForeground}>
            No images, pasted blocks, or terminal selections in this prompt.
          </text>
        )}
        {items.length > 0 && (
          <Select
            id='agent-prompt-items'
            options={items.map((item, index) => ({
              name: item.name,
              description: '',
              value: index,
            }))}
            selectedIndex={Math.min(selected, items.length - 1)}
            onChange={setSelected}
            onSelect={(index) => items[index]?.remove()}
            focused
            height={Math.min(6, items.length)}
            textColor={theme.foreground}
            selectedTextColor={theme.primaryForeground}
            selectedBackgroundColor={theme.primary}
          />
        )}
        <text fg={theme.mutedForeground}>
          {items[Math.min(selected, items.length - 1)]?.description ?? ''}
        </text>
      </scrollbox>
    </Dialog>
  )
}
