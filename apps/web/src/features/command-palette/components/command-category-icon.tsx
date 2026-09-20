import {
  ArrowsOutSimpleIcon,
  CommandIcon,
  TerminalWindowIcon,
  TextTIcon,
} from '@phosphor-icons/react'

type CommandCategoryIconProps = {
  readonly category: string
}

export function CommandCategoryIcon({ category }: CommandCategoryIconProps) {
  if (category === 'Editor') {
    return <TextTIcon className='text-muted-foreground' weight='duotone' />
  }
  if (category === 'Workspace') {
    return <TerminalWindowIcon className='text-muted-foreground' weight='duotone' />
  }
  if (category === 'Window Management') {
    return <ArrowsOutSimpleIcon className='text-muted-foreground' weight='duotone' />
  }

  return <CommandIcon className='text-muted-foreground' weight='duotone' />
}
