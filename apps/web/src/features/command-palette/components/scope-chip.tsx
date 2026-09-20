import { Badge } from '@workspace/ui/components/badge'

type ScopeChipProps = {
  readonly label: string
}

/** Stands in for the prefix a sub-picker used to keep in the input. */
export function ScopeChip({ label }: ScopeChipProps) {
  return (
    <Badge variant='secondary' className='font-normal'>
      {label}
    </Badge>
  )
}
