import { Fragment } from 'react'

/** The trigger's label; an ultra effort wears the rainbow, which drifts while the trigger is hovered or open. */
export function ModelOptionsSummary({
  parts,
  ultraPartId,
}: {
  readonly parts: readonly { id: string; label: string }[]
  /** The part to paint, when the effort is an ultra level. */
  readonly ultraPartId: string | undefined
}) {
  return (
    <span className='truncate'>
      {parts.map((part, index) => (
        <Fragment key={part.id}>
          {index > 0 ? ' · ' : null}
          {part.id === ultraPartId ? (
            <span className='rainbow-text group-hover/options:rainbow-live group-data-popup-open/options:rainbow-live font-medium'>
              {part.label}
            </span>
          ) : (
            part.label
          )}
        </Fragment>
      ))}
    </span>
  )
}
