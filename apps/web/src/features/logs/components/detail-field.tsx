type LogsDetailFieldProps = {
  label: string
  value: string
}

export function LogsDetailField({ label, value }: LogsDetailFieldProps) {
  return (
    <div className='min-w-0'>
      <span className='text-muted-foreground font-meta'>{label}</span>
      <span className='ml-2 break-words'>{value}</span>
    </div>
  )
}
