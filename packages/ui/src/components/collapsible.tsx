'use client'

import { playClickFeedback } from '@workspace/ui/patterns/feedback-layer'

import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible'

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot='collapsible' {...props} />
}

function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger
      data-slot='collapsible-trigger'
      data-feedback='tap'
      data-press-depth
      {...props}
      onClickCapture={(event) => {
        props.onClickCapture?.(event)
        playClickFeedback(event.nativeEvent, event.currentTarget)
      }}
    />
  )
}

function CollapsibleContent({ ...props }: CollapsiblePrimitive.Panel.Props) {
  return <CollapsiblePrimitive.Panel data-slot='collapsible-content' {...props} />
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
