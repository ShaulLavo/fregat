import { createPortal, useRenderer, useTerminalDimensions } from '@opentui/react'
import type { ReactNode } from 'react'

import { useCommandHandlers } from '@/commands/hooks/use-command-handlers'
import { useCommands } from '@/commands/hooks/use-commands'
import { commandShortcut } from '@/commands/utils/bindings'
import type { Theme } from '@/theme/utils/theme'

export function Dialog({
  title,
  theme,
  onClose,
  children,
  footer,
  dismissLabel = 'cancel',
  width = 72,
  height,
}: {
  title: string
  theme: Theme
  onClose: () => void
  children: ReactNode
  footer?: string
  dismissLabel?: string | null
  width?: number
  height?: number
}) {
  const dimensions = useTerminalDimensions()
  const compact = dimensions.height < 20
  const renderer = useRenderer()
  const commands = useCommands()
  const dismissKeys = commandShortcut(commands.bindings, 'workspace.dismiss').replaceAll(
    'Escape',
    'Esc',
  )
  const dismissHint =
    dismissKeys === 'unassigned' ? 'Dismiss unassigned' : `${dismissKeys} ${dismissLabel}`
  useCommandHandlers({ 'workspace.dismiss': { run: onClose } })
  const portal = createPortal(
    <box
      position='absolute'
      width='100%'
      height='100%'
      justifyContent='center'
      alignItems='center'
      zIndex={10}
    >
      <box
        width={Math.max(1, Math.min(width, dimensions.width - 2))}
        height={height}
        maxHeight={Math.max(1, dimensions.height - 2)}
        overflow='hidden'
        border
        borderStyle='single'
        borderColor={theme.border}
        backgroundColor={theme.popover}
        padding={compact ? 0 : 1}
        gap={compact ? 0 : 1}
        flexDirection='column'
      >
        <text fg={theme.foreground} flexShrink={0}>
          <strong>{title}</strong>
        </text>
        {children}
        <text fg={theme.mutedForeground} flexShrink={0}>
          {[footer, dismissLabel && dismissHint].filter(Boolean).join(' · ')}
        </text>
      </box>
    </box>,
    renderer.root,
    null,
  )
  // OpenTUI exposes the reconciler portal type; the fragment supplies the JSX boundary.
  return <>{portal}</>
}
