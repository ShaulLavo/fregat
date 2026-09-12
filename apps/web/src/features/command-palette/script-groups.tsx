import { PlayIcon } from '@phosphor-icons/react'
import { CommandEmpty, CommandGroup, CommandItem } from '@workspace/ui/components/command'

import { useCommandPaletteActions } from '@/features/command-palette/hooks/use-command-palette-actions'
import type { ProjectScriptSuggestion } from '@/features/chat-mode/utils/project-scripts'

/**
 * The project's own commands, saved ones first and the rest read out of its
 * manifest. Picking one runs it in the terminal rather than pasting it, because
 * a command you still have to press Enter on is not a shortcut.
 */
export function ScriptGroups({
  scripts,
}: {
  readonly scripts: readonly ProjectScriptSuggestion[]
}) {
  const { selectScript } = useCommandPaletteActions()
  const saved = scripts.filter((script) => script.saved)
  const discovered = scripts.filter((script) => !script.saved)

  if (scripts.length === 0) {
    return <CommandEmpty>No scripts in this project.</CommandEmpty>
  }

  return (
    <>
      <ScriptGroup heading='Project Scripts' scripts={saved} onSelect={selectScript} />
      <ScriptGroup heading='From package.json' scripts={discovered} onSelect={selectScript} />
    </>
  )
}

function ScriptGroup({
  heading,
  scripts,
  onSelect,
}: {
  readonly heading: string
  readonly scripts: readonly ProjectScriptSuggestion[]
  readonly onSelect: (script: ProjectScriptSuggestion) => void
}) {
  if (scripts.length === 0) return null

  return (
    <CommandGroup heading={heading}>
      {scripts.map((script) => (
        <CommandItem
          key={script.command}
          keywords={[script.command]}
          value={script.command}
          onSelect={() => onSelect(script)}
        >
          <PlayIcon className='size-4 shrink-0 opacity-60' />
          <span className='truncate'>{script.name}</span>
          <span className='text-muted-foreground text-2xs ml-auto truncate pl-3 font-mono'>
            {script.command}
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  )
}
