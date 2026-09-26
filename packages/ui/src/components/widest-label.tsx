import { widestLabels } from '@workspace/ui/lib/widest-labels'

/**
 * A trigger label that reserves the width of its longest option, so choosing another option
 * never reshapes the row. Only for short, closed option sets; an unbounded list keeps a cap.
 */
function WidestLabel({
  children,
  labels,
}: {
  readonly children: string
  readonly labels: readonly string[]
}) {
  return (
    <span className='grid min-w-0 grid-cols-[minmax(0,auto)]'>
      {widestLabels(labels, children).map((label) => (
        <span aria-hidden='true' className='invisible col-start-1 row-start-1 truncate' key={label}>
          {label}
        </span>
      ))}
      <span className='col-start-1 row-start-1 truncate'>{children}</span>
    </span>
  )
}

export { WidestLabel }
