import { Button as ButtonPrimitive } from '@base-ui/react/button'
import type { VariantProps } from 'class-variance-authority'

import { cn } from '@workspace/ui/lib/utils'
import { playClickFeedback } from '@workspace/ui/patterns/feedback-layer'

import { buttonVariants } from './button-variants'

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot='button'
      data-feedback='tap'
      data-variant={variant}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
      onClickCapture={(event) => {
        props.onClickCapture?.(event)
        playClickFeedback(event.nativeEvent, event.currentTarget)
      }}
    />
  )
}

export { Button, buttonVariants }
