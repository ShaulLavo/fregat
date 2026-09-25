import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox'
import { CaretDownIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'

import { listRowClassName } from '@workspace/ui/patterns/list-row-classes'
import { cn } from '@workspace/ui/lib/utils'

/**
 * An autocomplete over a list the caller ranks: pass `filteredItems` and `filter={null}`, and
 * the primitive owns only focus, highlight and selection. The search field sits in the popup,
 * so the trigger can show the current value however the caller draws it.
 */
const Combobox = ComboboxPrimitive.Root
const ComboboxCollection = ComboboxPrimitive.Collection

function ComboboxTrigger({ className, children, ...props }: ComboboxPrimitive.Trigger.Props) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot='combobox-trigger'
      className={cn(
        'focus-ring flex h-(--density-control-height) w-fit min-w-0 items-center justify-between gap-1.5 rounded-md border border-transparent bg-input/30 pr-2 pl-(--density-control-padding-x) text-xs whitespace-nowrap outline-none select-none disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-input/50',
        className,
      )}
      {...props}
    >
      {children}
      <CaretDownIcon className='text-muted-foreground pointer-events-none size-(--icon-size) shrink-0' />
    </ComboboxPrimitive.Trigger>
  )
}

function ComboboxContent({
  className,
  children,
  side = 'bottom',
  sideOffset = 4,
  align = 'start',
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<ComboboxPrimitive.Positioner.Props, 'align' | 'side' | 'sideOffset'>) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        className='isolate z-50'
      >
        <ComboboxPrimitive.Popup
          data-slot='combobox-content'
          className={cn(
            'relative isolate z-50 flex max-h-(--available-height) w-72 origin-(--transform-origin) flex-col overflow-hidden rounded-lg text-popover-foreground shadow-md ring-1 ring-foreground/10 bg-popover-solid ease-out-strong data-open:animation-duration-(--duration-enter) data-closed:animation-duration-(--duration-exit) data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            className,
          )}
          {...props}
        >
          {children}
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

function ComboboxInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
  return (
    <div className='flex h-(--bar-height) shrink-0 items-center gap-(--density-control-gap) px-(--bar-padding-x)'>
      <MagnifyingGlassIcon className='text-muted-foreground size-(--icon-size) shrink-0' />
      <ComboboxPrimitive.Input
        data-slot='combobox-input'
        className={cn(
          'h-full min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground',
          className,
        )}
        {...props}
      />
    </div>
  )
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      data-slot='combobox-list'
      className={cn('min-h-0 flex-1 overflow-y-auto pb-1', className)}
      {...props}
    />
  )
}

function ComboboxGroup(props: ComboboxPrimitive.Group.Props) {
  return <ComboboxPrimitive.Group data-slot='combobox-group' {...props} />
}

function ComboboxGroupLabel({ className, ...props }: ComboboxPrimitive.GroupLabel.Props) {
  return (
    <ComboboxPrimitive.GroupLabel
      data-slot='combobox-group-label'
      className={cn(
        'section-label flex h-(--density-row-height) items-center px-(--density-row-padding-x)',
        className,
      )}
      {...props}
    />
  )
}

/** A list row: the highlight is the row hover, the chosen value is the row selection. */
function ComboboxItem({ className, ...props }: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot='combobox-item'
      className={listRowClassName({
        interactive: false,
        className: cn(
          'cursor-default data-highlighted:bg-row-hover data-selected:bg-row-selected data-disabled:opacity-50',
          className,
        ),
      })}
      {...props}
    />
  )
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      data-slot='combobox-empty'
      className={cn(
        'text-muted-foreground px-(--density-row-padding-x) text-xs empty:hidden',
        className,
      )}
      {...props}
    />
  )
}

export {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
}
