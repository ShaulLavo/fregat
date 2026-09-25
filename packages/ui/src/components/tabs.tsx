import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@workspace/ui/lib/utils'

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot='tabs'
      className={cn('flex min-w-0 flex-col gap-2', className)}
      {...props}
    />
  )
}

// `tabs` switches panels; `segmented` is the compact row that swaps one view. The list carries
// no fill and no radius: the sliding indicator is the only surface.
const tabsListVariants = cva(
  'group/tabs-list relative isolate inline-flex w-fit min-w-0 items-center',
  {
    variants: {
      variant: {
        tabs: 'gap-1',
        segmented: 'gap-0.5',
      },
    },
    defaultVariants: { variant: 'tabs' },
  },
)

function TabsList({
  className,
  variant = 'tabs',
  children,
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot='tabs-list'
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    >
      {children}
      <TabsPrimitive.Indicator
        data-slot='tabs-indicator'
        renderBeforeHydration
        className='bg-accent absolute top-0 left-0 -z-10 h-(--active-tab-height) w-(--active-tab-width) translate-x-(--active-tab-left) translate-y-(--active-tab-top) rounded-md transition-[translate,width] duration-(--duration-enter) ease-(--ease-in-out-strong) motion-reduce:transition-none'
      />
    </TabsPrimitive.List>
  )
}

function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot='tabs-tab'
      className={cn(
        'focus-ring text-muted-foreground inline-flex shrink-0 items-center justify-center gap-1 rounded-md font-medium whitespace-nowrap outline-none select-none',
        'h-(--density-control-height-sm) px-(--density-control-padding-x) text-xs transition-colors',
        'group-data-[variant=segmented]/tabs-list:px-(--density-control-padding-x-tight)',
        'not-data-disabled:hover:text-foreground aria-selected:text-accent-foreground data-disabled:opacity-50',
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-(--icon-size-sm)",
        className,
      )}
      {...props}
    />
  )
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot='tabs-panel'
      className={cn('min-h-0 flex-1 outline-none', className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTab, TabsPanel }
