import {
  InlineRenameInput as WorkbenchInlineRenameInput,
  type InlineRenameInputProps as WorkbenchInlineRenameInputProps,
} from '@shaulavo/workbench-ui'

import { INPUT_CLASS_NAME } from '@workspace/ui/components/input'
import { cn } from '@workspace/ui/lib/utils'

type InlineRenameInputProps = Omit<WorkbenchInlineRenameInputProps, 'onCommit'> & {
  readonly onCommit: (value: string) => void
}

export function InlineRenameInput({ onCommit, className, ...props }: InlineRenameInputProps) {
  return (
    <WorkbenchInlineRenameInput
      {...props}
      className={cn(
        INPUT_CLASS_NAME,
        'h-[calc(var(--density-row-height)-4px)] bg-transparent px-(--density-row-padding-x) shadow-none',
        className,
      )}
      data-slot='input'
      onCommit={(value) => onCommit(value)}
    />
  )
}
