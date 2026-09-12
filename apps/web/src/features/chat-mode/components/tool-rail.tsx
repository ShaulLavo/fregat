import {
  CodeIcon,
  FilesIcon,
  GitBranchIcon,
  MagnifyingGlassIcon,
  ScrollIcon,
  TerminalIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import type { ReactNode } from 'react'

import {
  CHAT_MODE_TOOL_TABS,
  chatModeToolTabLabel,
  type ChatModePanels,
  type ChatModeToolTab,
} from '@/features/chat-mode/utils/panels'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'

export function ToolRail({
  panels,
  onSelectTab,
}: {
  readonly panels: ChatModePanels
  readonly onSelectTab: (tab: ChatModeToolTab) => void
}) {
  return (
    <nav
      aria-label='Tool tabs'
      className='bg-card backdrop-material border-border flex w-(--rail-width) shrink-0 flex-col items-center gap-1 border-l p-1'
    >
      {CHAT_MODE_TOOL_TABS.map((tab) => (
        <Button
          aria-label={chatModeToolTabLabel(tab)}
          aria-pressed={panels.toolPaneOpen && panels.activeToolTab === tab}
          className={cn(
            'text-muted-foreground hover:text-foreground',
            panels.toolPaneOpen &&
              panels.activeToolTab === tab &&
              'bg-accent text-accent-foreground',
          )}
          key={tab}
          size='icon-sm'
          title={chatModeToolTabLabel(tab)}
          type='button'
          variant='ghost'
          onClick={() => onSelectTab(tab)}
        >
          {toolTabIcon(tab)}
        </Button>
      ))}
    </nav>
  )
}

function toolTabIcon(tab: ChatModeToolTab): ReactNode {
  const className = 'size-4'
  if (tab === 'editor') return <CodeIcon className={className} />
  if (tab === 'files') return <FilesIcon className={className} />
  if (tab === 'git') return <GitBranchIcon className={className} />
  if (tab === 'logs') return <ScrollIcon className={className} />
  if (tab === 'problems') return <WarningCircleIcon className={className} />
  if (tab === 'search') return <MagnifyingGlassIcon className={className} />

  return <TerminalIcon className={className} />
}
