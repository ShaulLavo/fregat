export function LargeFileNotice({
  analysisAllowed,
  minimapAllowed,
}: {
  readonly analysisAllowed: boolean
  readonly minimapAllowed: boolean
}) {
  if (analysisAllowed && minimapAllowed) return null
  const paused = [
    ...(!analysisAllowed ? ['syntax, language services, folding and document analysis'] : []),
    ...(!minimapAllowed ? ['minimap'] : []),
  ].join('; ')
  return (
    <div
      role='status'
      data-testid='large-file-mode'
      className='bg-info/10 text-muted-foreground absolute inset-x-0 bottom-0 px-3 py-2 text-xs'
    >
      Large file mode: {paused} paused. Editing and saving remain available.
    </div>
  )
}
