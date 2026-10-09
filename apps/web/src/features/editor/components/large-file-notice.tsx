export function LargeFileNotice({
  analysisAllowed,
  minimapAllowed,
}: {
  readonly analysisAllowed: boolean
  readonly minimapAllowed: boolean
}) {
  if (analysisAllowed && minimapAllowed) return null
  const paused = (analysisAllowed ? [] : ['syntax colours', 'language services', 'folding']).concat(
    minimapAllowed ? [] : ['the minimap'],
  )
  const list =
    paused.length === 1 ? paused[0] : `${paused.slice(0, -1).join(', ')} and ${paused.at(-1)}`
  return (
    <div
      role='status'
      data-testid='large-file-mode'
      className='bg-info/10 text-muted-foreground shrink-0 px-3 py-2 text-xs'
    >
      Large file: {list} {paused.length === 1 ? 'is' : 'are'} paused. Editing and saving work as
      usual.
    </div>
  )
}
