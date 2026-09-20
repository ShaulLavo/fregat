import { cva } from 'class-variance-authority'

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center focus-ring pressable rounded-md border border-transparent bg-clip-padding text-xs font-medium whitespace-nowrap outline-none select-none disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-(--icon-size)",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground [a]:hover:bg-primary/80',
        outline:
          'border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        ghost:
          'hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50',
        destructive:
          'bg-destructive/10 text-destructive hover:bg-destructive/20 [--focus-ring-color:var(--destructive)] dark:bg-destructive/20 dark:hover:bg-destructive/30',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default:
          'h-(--density-control-height) gap-(--density-control-gap) px-(--density-control-padding-x) has-data-[icon=inline-end]:pr-(--density-control-padding-x-tight) has-data-[icon=inline-start]:pl-(--density-control-padding-x-tight)',
        xs: "h-6 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-(--icon-size-sm)",
        sm: "h-(--density-control-height-sm) gap-1 px-(--density-control-padding-x) has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-(--icon-size-sm)",
        lg: 'h-(--density-control-height-lg) gap-(--density-control-gap) px-(--density-control-padding-x) has-data-[icon=inline-end]:pr-(--density-control-padding-x-tight) has-data-[icon=inline-start]:pl-(--density-control-padding-x-tight)',
        icon: 'size-(--density-control-height)',
        'icon-xs': "size-6 [&_svg:not([class*='size-'])]:size-(--icon-size-sm)",
        'icon-sm': 'size-(--density-control-height-sm)',
        'icon-lg': 'size-(--density-control-height-lg)',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export { buttonVariants }
