import type { CSSProperties } from 'react'
import { CheckCircleIcon, InfoIcon, WarningIcon, XIcon } from '@phosphor-icons/react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

import { buttonVariants } from './button-variants'
import { Spinner } from '@workspace/ui/components/spinner'
import { ToastErrorIcon } from '@workspace/ui/components/toast-error-icon'
import { cn } from '@workspace/ui/lib/utils'

type ToasterStyle = CSSProperties & Record<`--${string}`, string>

// The toast is `unstyled`: Sonner keeps position, stacking and swipe, and every
// pixel of the surface below is ours. Status reads from the icon alone.
const TOASTER_STYLE = { '--width': '380px' } satisfies ToasterStyle

const TOAST_ICONS = {
  close: <XIcon />,
  error: <ToastErrorIcon />,
  info: <InfoIcon className='text-info' weight='fill' />,
  loading: <Spinner />,
  success: <CheckCircleIcon className='text-success' weight='fill' />,
  warning: <WarningIcon className='text-warning' weight='fill' />,
}

const TOAST_CLASS_NAMES = {
  // Sonner's own stylesheet is unlayered, so its box-shadow beats a layered
  // utility; `!` keeps the D6 step. The icon column is padding, not a grid
  // column, so actions wrap under the text and custom toasts get the full width.
  toast: cn(
    'flex w-(--width) flex-wrap items-center justify-end gap-x-(--density-control-gap) gap-y-(--density-section-gap) rounded-lg bg-popover-solid p-(--density-section-padding) text-xs text-popover-foreground shadow-md! ring-1 ring-foreground/10',
    'has-[>[data-icon]]:pl-[calc(var(--density-section-padding)+var(--icon-size)+0.5rem)]',
    '[&:has(>[data-close-button])>[data-content]]:pr-7',
    // Sonner only hides the text of stacked-behind toasts when it styles them.
    'data-[expanded=false]:data-[front=false]:*:opacity-0',
  ),
  icon: 'absolute top-(--density-section-padding) left-(--density-section-padding) flex h-5 w-(--icon-size) items-center [&_svg]:size-(--icon-size)',
  content: 'flex min-w-0 basis-full flex-col gap-0.5',
  title: 'text-sm font-medium',
  // Sonner's dark theme colours descriptions unlayered; the Toaster never sets it.
  // Descriptions carry values the app did not author, which `word-break` splits mid-token.
  description: 'text-xs/relaxed text-muted-foreground [overflow-wrap:anywhere]',
  closeButton: cn(
    buttonVariants({ size: 'icon-xs', variant: 'ghost' }),
    'absolute top-[calc(var(--density-section-padding)-2px)] right-[calc(var(--density-section-padding)-4px)] text-muted-foreground',
  ),
  cancelButton: buttonVariants({ size: 'sm', variant: 'ghost' }),
  actionButton: buttonVariants({ size: 'sm' }),
}

export function Toaster({
  className,
  closeButton = true,
  style,
  toastOptions,
  ...props
}: Omit<ToasterProps, 'richColors' | 'theme'>) {
  return (
    <Sonner
      closeButton={closeButton}
      className={cn('toaster group', className)}
      icons={TOAST_ICONS}
      style={{ ...TOASTER_STYLE, ...style }}
      toastOptions={{
        ...toastOptions,
        unstyled: true,
        classNames: { ...TOAST_CLASS_NAMES, ...toastOptions?.classNames },
      }}
      {...props}
    />
  )
}
