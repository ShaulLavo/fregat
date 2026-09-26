import { PlayIcon } from '@phosphor-icons/react'
import { CommandItem } from '@workspace/ui/components/command'

import type { ProjectScriptSuggestion } from '@/features/chat-mode/utils/project-scripts'

export function ScriptRow({
  onSelect,
  script,
}: {
  readonly onSelect: (script: ProjectScriptSuggestion) => void
  readonly script: ProjectScriptSuggestion
}) {
  return (
    <CommandItem
      disabled={script.origin === 't3.json' && !script.saved}
      keywords={[script.command]}
      title={script.command}
      value={script.command}
      onSelect={() => onSelect(script)}
    >
      <PlayIcon className='size-(--icon-size) shrink-0 opacity-60' />
      <span className='truncate'>{script.name}</span>
      <span className='text-muted-foreground text-2xs ml-auto truncate pl-3 font-mono'>
        {script.command}
      </span>
    </CommandItem>
  )
}
