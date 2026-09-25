// Two significant digits in plain notation; `toPrecision` switches to `4.2e-7`.
const SUB_CENT = new Intl.NumberFormat('en-US', {
  minimumSignificantDigits: 2,
  maximumSignificantDigits: 2,
  useGrouping: false,
})

/**
 * Dollars for usage costs. Under a cent the digits are real (`$0.0042`), because
 * a model can cost fractions of a cent per turn; `$0.00` is only a true zero.
 */
export function formatUsd(value: number) {
  if (value === 0) return '$0.00'
  if (value < 0.01) return `$${SUB_CENT.format(value)}`

  return new Intl.NumberFormat('en-US', {
    currency: 'USD',
    maximumFractionDigits: value < 100 ? 2 : 0,
    minimumFractionDigits: value < 100 ? 2 : 0,
    style: 'currency',
  }).format(value)
}
