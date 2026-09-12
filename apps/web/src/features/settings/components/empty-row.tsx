export function EmptyRow({ children }: { children: string }) {
  return (
    <p className='text-muted-foreground px-(--density-control-padding-x) py-(--density-section-padding) text-xs'>
      {children}
    </p>
  )
}
