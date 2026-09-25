import {
  useId,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type TransitionEvent,
} from 'react'

import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'

type HoldButtonProps = Omit<
  ComponentProps<typeof Button>,
  | 'onClick'
  | 'variant'
  | 'onBlur'
  | 'onKeyDown'
  | 'onKeyUp'
  | 'onPointerDown'
  | 'onPointerUp'
  | 'onPointerLeave'
  | 'onPointerCancel'
> & {
  readonly variant?: 'destructive' | 'default'
  /** Runs once, when the fill lands. */
  onConfirm(): void
}

const FILL_CLASS = {
  destructive: 'bg-destructive text-background',
  default: 'bg-foreground text-background',
} as const

const HOLD_KEYS = new Set(['Enter', ' '])

/**
 * Confirms an action that cannot be undone by holding it, with the pointer or with Space or
 * Enter. The fill is one clip-path transition over `--duration-hold`, and its end is the
 * confirmation, so a hold renders twice and no script counts time.
 */
function HoldButton({
  variant = 'destructive',
  onConfirm,
  children,
  className,
  disabled,
  ...props
}: HoldButtonProps) {
  const [holding, setHolding] = useState(false)
  const [cancelled, setCancelled] = useState(false)
  const hintId = useId()

  function start() {
    setCancelled(false)
    if (!disabled) setHolding(true)
  }

  function cancel() {
    if (holding) setCancelled(true)
    setHolding(false)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!HOLD_KEYS.has(event.key)) return
    event.preventDefault()
    if (!event.repeat) start()
  }

  function handleKeyUp(event: KeyboardEvent<HTMLButtonElement>) {
    if (!HOLD_KEYS.has(event.key)) return
    event.preventDefault()
    cancel()
  }

  function handleFillEnd(event: TransitionEvent<HTMLSpanElement>) {
    if (event.target !== event.currentTarget || event.propertyName !== 'clip-path') return
    if (!holding) return
    setHolding(false)
    onConfirm()
  }

  return (
    <>
      <Button
        aria-describedby={hintId}
        className={cn('hold-button relative overflow-hidden select-none', className)}
        data-holding={holding ? '' : undefined}
        data-cancelled={cancelled ? '' : undefined}
        data-slot='hold-button'
        disabled={disabled}
        type='button'
        variant={variant}
        onBlur={cancel}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onPointerCancel={cancel}
        onPointerDown={(event) => {
          if (event.button === 0) start()
        }}
        onPointerLeave={cancel}
        onPointerUp={cancel}
        {...props}
      >
        {children}
        {/* The fill carries its own copy of the label, so the sweep edge crosses the letters. */}
        <span
          aria-hidden='true'
          className={cn(
            'hold-button-fill absolute inset-0 inline-flex items-center justify-center gap-[inherit]',
            FILL_CLASS[variant],
          )}
          onTransitionEnd={handleFillEnd}
        >
          {children}
        </span>
      </Button>
      <span className='sr-only' id={hintId}>
        Hold to confirm
      </span>
    </>
  )
}

export { HoldButton }
