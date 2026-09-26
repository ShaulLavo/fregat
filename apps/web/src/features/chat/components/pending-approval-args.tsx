export function PendingApprovalArgs({
  args,
  label,
}: {
  readonly args: readonly (readonly [string, string])[]
  readonly label: string
}) {
  return (
    <dl
      aria-label={label}
      className='text-2xs grid max-h-20 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 overflow-auto overscroll-contain'
    >
      {args.map(([name, value]) => (
        <div className='contents' key={name}>
          <dt className='text-muted-foreground font-mono'>{name}</dt>
          <dd className='text-foreground truncate font-mono' title={value}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
