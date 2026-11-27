import {
  InlineRenameInput as WorkbenchInlineRenameInput,
  type InlineRenameInputProps as WorkbenchInlineRenameInputProps,
} from '@shaulavo/workbench-ui'

import { cn } from '@workspace/ui/lib/utils'

type InlineRenameInputProps = Omit<WorkbenchInlineRenameInputProps, 'onCommit'> & {
  readonly onCommit: (value: string) => void
}

export function InlineRenameInput({ onCommit, className, ...props }: InlineRenameInputProps) {
  return (
    <WorkbenchInlineRenameInput
      {...props}
      className={cn(
        'h-[calc(var(--density-row-height)-4px)] bg-transparent px-(--density-row-padding-x) shadow-none',
        className,
      )}
      onCommit={(value) => onCommit(value)}
    />
  )
}
