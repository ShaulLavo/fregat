import { WarningCircleIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { cn } from '@workspace/ui/lib/utils'
import type { ComponentProps, ReactNode } from 'react'

type ActionDialogContentProps = Omit<ComponentProps<typeof DialogContent>, 'title'> & {
  title: ReactNode
  description: ReactNode
  path?: string
  error: string | null
  pending: boolean
  onCancel: () => void
}

export function ActionDialogContent({
  title,
  description,
  path,
  error,
  pending,
  onCancel,
  children,
  className,
  ...props
}: ActionDialogContentProps) {
  return (
    <DialogContent
      {...props}
      className={cn(
        'w-[min(420px,calc(100vw-2rem))] max-w-none border text-sm sm:max-w-none',
        className,
      )}
      showCloseButton={false}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {path !== undefined ? (
        <div
          className='bg-muted/30 text-muted-foreground truncate rounded-lg border px-(--density-control-padding-x) py-(--density-section-gap) text-xs'
          title={path}
        >
          {path}
        </div>
      ) : null}
      {error ? (
        <div
          className='border-destructive/25 bg-destructive/10 text-destructive flex items-start gap-(--density-control-gap) rounded-lg border px-(--density-control-padding-x) py-(--density-section-gap) text-xs'
          role='alert'
        >
          <WarningCircleIcon className='mt-0.5 size-(--icon-size-sm) shrink-0' />
          <span>{error}</span>
        </div>
      ) : null}
      <DialogFooter>
        <Button disabled={pending} onClick={onCancel} type='button' variant='outline'>
          Cancel
        </Button>
        {children}
      </DialogFooter>
    </DialogContent>
  )
}
