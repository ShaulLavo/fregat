import { encode } from 'uqr'

/** A QR code as one SVG path of unit squares, and the side of the square it fills. */
export function qrPath(value: string) {
  const { data, size } = encode(value, { border: 2, ecc: 'M' })
  const cells: string[] = []
  for (const [y, row] of data.entries())
    for (const [x, dark] of row.entries()) if (dark) cells.push(`M${x} ${y}h1v1h-1z`)
  return { path: cells.join(''), size }
}
