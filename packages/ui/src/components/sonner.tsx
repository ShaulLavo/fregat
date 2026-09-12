import type { CSSProperties } from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

import { cn } from '@workspace/ui/lib/utils'

type ToastThemeStyle = CSSProperties & Record<`--${string}`, string>

const toastThemeStyle = {
  '--normal-bg': 'var(--popover-solid)',
  '--normal-border': 'var(--border)',
  '--normal-border-hover': 'var(--border)',
  '--normal-bg-hover': 'var(--muted-solid)',
  '--normal-text': 'var(--popover-foreground)',
  // The lg step (D1: a toast is a floating surface). Spelled `--radius` because
  // the radius scale is `@theme inline`, which emits no custom properties.
  '--border-radius': 'var(--radius)',
  // Oklab tints toward each status color without rotating the popover's hue.
  '--error-bg': 'color-mix(in oklab, var(--destructive) 12%, var(--popover-solid))',
  '--error-border': 'color-mix(in oklab, var(--destructive) 45%, transparent)',
  '--error-text': 'color-mix(in oklab, var(--destructive) 70%, var(--popover-foreground))',
  '--success-bg': 'color-mix(in oklab, var(--success) 12%, var(--popover-solid))',
  '--success-border': 'color-mix(in oklab, var(--success) 45%, transparent)',
  '--success-text': 'color-mix(in oklab, var(--success) 70%, var(--popover-foreground))',
  '--warning-bg': 'color-mix(in oklab, var(--warning) 12%, var(--popover-solid))',
  '--warning-border': 'color-mix(in oklab, var(--warning) 45%, transparent)',
  '--warning-text': 'color-mix(in oklab, var(--warning) 70%, var(--popover-foreground))',
  '--info-bg': 'color-mix(in oklab, var(--info) 12%, var(--popover-solid))',
  '--info-border': 'color-mix(in oklab, var(--info) 45%, transparent)',
  '--info-text': 'color-mix(in oklab, var(--info) 70%, var(--popover-foreground))',
} satisfies ToastThemeStyle

// Sonner appends an unlayered stylesheet at runtime, so a layered utility loses
// to its built-in toast shadow; `!` is what makes the D6 step stick.
const TOAST_SURFACE_CLASS = 'shadow-md!'

export function Toaster({
  className,
  closeButton = true,
  richColors = true,
  style,
  theme = 'system',
  toastOptions,
  ...props
}: ToasterProps) {
  return (
    <Sonner
      closeButton={closeButton}
      className={cn('toaster group', className)}
      richColors={richColors}
      style={{ ...toastThemeStyle, ...style }}
      theme={theme}
      toastOptions={{
        ...toastOptions,
        classNames: { toast: TOAST_SURFACE_CLASS, ...toastOptions?.classNames },
      }}
      {...props}
    />
  )
}
