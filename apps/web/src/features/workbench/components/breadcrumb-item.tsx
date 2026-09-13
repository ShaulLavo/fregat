import {
  BreadcrumbItem as BreadcrumbListItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
} from '@workspace/ui/components/breadcrumb'
import { Popover, PopoverContent, PopoverTrigger } from '@workspace/ui/components/popover'
import { cn } from '@workspace/ui/lib/utils'
import type { ReactNode } from 'react'

export function BreadcrumbItem({
  children,
  first,
  icon,
  label,
  open,
  onOpenChange,
}: {
  readonly children: ReactNode
  readonly first: boolean
  readonly icon: ReactNode
  readonly label: string
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}) {
  return (
    <>
      {first ? null : <BreadcrumbSeparator />}
      <BreadcrumbListItem className='shrink-0'>
        <Popover open={open} onOpenChange={onOpenChange}>
          <BreadcrumbLink
            className={cn(
              'focus-visible:text-foreground flex h-full items-center gap-1 px-0.5 outline-none focus-visible:underline',
              open && 'text-foreground underline',
            )}
            data-breadcrumb-item=''
            render={<PopoverTrigger />}
          >
            {icon}
            <span>{label}</span>
          </BreadcrumbLink>
          {/* Mounted only while open: a folder listing is a request. */}
          {open ? (
            <PopoverContent
              align='start'
              className='max-h-[min(70vh,20rem)] w-96 max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0'
              sideOffset={2}
            >
              {children}
            </PopoverContent>
          ) : null}
        </Popover>
      </BreadcrumbListItem>
    </>
  )
}
