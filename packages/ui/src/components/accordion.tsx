import { Accordion as AccordionPrimitive } from '@base-ui/react/accordion'

import { cn } from '@workspace/ui/lib/utils'
import { CaretDownIcon, CaretUpIcon } from '@phosphor-icons/react'

function Accordion({ className, ...props }: AccordionPrimitive.Root.Props) {
  return (
    <AccordionPrimitive.Root
      data-slot='accordion'
      className={cn('flex w-full flex-col', className)}
      {...props}
    />
  )
}

function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
  return (
    <AccordionPrimitive.Item
      data-slot='accordion-item'
      className={cn('not-last:border-b', className)}
      {...props}
    />
  )
}

function AccordionTrigger({ className, children, ...props }: AccordionPrimitive.Trigger.Props) {
  return (
    <AccordionPrimitive.Header className='flex'>
      <AccordionPrimitive.Trigger
        data-slot='accordion-trigger'
        className={cn(
          'focus-ring group/accordion-trigger relative flex flex-1 items-start justify-between border border-transparent py-(--density-accordion-padding-y) text-left text-xs font-medium outline-none hover:underline aria-disabled:pointer-events-none aria-disabled:opacity-50 **:data-[slot=accordion-trigger-icon]:ml-auto **:data-[slot=accordion-trigger-icon]:size-4 **:data-[slot=accordion-trigger-icon]:text-muted-foreground',
          className,
        )}
        {...props}
      >
        {children}
        <CaretDownIcon
          data-slot='accordion-trigger-icon'
          className='pointer-events-none shrink-0 group-aria-expanded/accordion-trigger:hidden'
        />
        <CaretUpIcon
          data-slot='accordion-trigger-icon'
          className='pointer-events-none hidden shrink-0 group-aria-expanded/accordion-trigger:inline'
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

function AccordionContent({ className, children, ...props }: AccordionPrimitive.Panel.Props) {
  return (
    <AccordionPrimitive.Panel
      data-slot='accordion-content'
      className='data-open:animate-accordion-down data-closed:animate-accordion-up overflow-hidden text-xs'
      {...props}
    >
      <div
        className={cn(
          'pt-0 pb-(--density-accordion-padding-y) [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-(--density-copy-paragraph-gap)',
          className,
        )}
      >
        {children}
      </div>
    </AccordionPrimitive.Panel>
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
