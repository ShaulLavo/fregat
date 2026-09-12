import { Badge } from '@workspace/ui/components/badge'

export function MachineChip({ label }: { readonly label: string }) {
  return (
    <Badge
      variant='secondary'
      className='max-w-28 truncate px-1 py-0 text-[10px] font-normal'
      title={`Machine: ${label}`}
    >
      {label}
    </Badge>
  )
}
