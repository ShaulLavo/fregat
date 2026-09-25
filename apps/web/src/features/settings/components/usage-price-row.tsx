import type { ModelPrice } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'

import { NumberWidget } from '@/features/settings/components/widgets/number-widget'

const PRICE_FIELDS = [
  ['input', 'Input'],
  ['cachedInput', 'Cached input'],
  ['output', 'Output'],
] as const satisfies ReadonlyArray<readonly [keyof ModelPrice, string]>

const NO_PRICE: ModelPrice = { cachedInput: 0, input: 0, output: 0 }

/** Dollars per million tokens, one model; clearing it returns the model to "No price". */
export function UsagePriceRow({
  disabled,
  model,
  onChange,
  price,
}: {
  readonly disabled: boolean
  readonly model: string
  readonly onChange: (price: ModelPrice | null) => void
  readonly price: ModelPrice | undefined
}) {
  const current = price ?? NO_PRICE

  return (
    <li className='bg-muted flex flex-col gap-2 rounded-lg p-3' data-usage-price={model}>
      <div className='flex items-center gap-2'>
        <span className='min-w-0 flex-1 truncate text-xs font-medium' title={model}>
          {model}
        </span>
        {price ? (
          <Button disabled={disabled} onClick={() => onChange(null)} size='sm' variant='ghost'>
            Clear
          </Button>
        ) : (
          <span className='text-muted-foreground text-2xs'>No price</span>
        )}
      </div>
      <div className='flex flex-wrap gap-3'>
        {PRICE_FIELDS.map(([field, label]) => (
          <label className='text-muted-foreground text-2xs flex flex-col gap-1' key={field}>
            {label} per 1M
            <NumberWidget
              disabled={disabled}
              id={`usage-price-${model}-${field}`}
              onCommit={(next) => onChange({ ...current, [field]: Math.max(0, next) })}
              value={current[field]}
            />
          </label>
        ))}
      </div>
    </li>
  )
}
