/** One refactor in five steps: types, an extracted helper, a reorder, then a reformat. */
export const TRANSITION_STEPS: readonly string[] = [
  `function total(items) {
  let sum = 0
  for (const item of items) {
    sum += item.price
  }
  return sum
}
`,
  `type Item = { price: number; quantity: number }

function total(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0)
}
`,
  `type Item = { price: number; quantity: number }

const lineTotal = (item: Item) => item.price * item.quantity

export function total(items: readonly Item[]): number {
  return items.reduce((sum, item) => sum + lineTotal(item), 0)
}
`,
  `type Item = { price: number; quantity: number }

export function total(items: readonly Item[], discount = 0): number {
  const sum = items.reduce((sum, item) => sum + lineTotal(item), 0)
  return sum * (1 - discount)
}

const lineTotal = (item: Item) => item.price * item.quantity
`,
  `type Item = {
  price: number
  quantity: number
}

export function total(
  items: readonly Item[],
  discount = 0,
): number {
  const sum = items.reduce(
    (sum, item) => sum + lineTotal(item),
    0,
  )
  return sum * (1 - discount)
}

const lineTotal = (item: Item) =>
  item.price * item.quantity
`,
]

/** Lines an agent writes into the middle of the file, one at a time. */
export const STREAMED_FUNCTION: readonly string[] = [
  '/** The total after tax, rounded to cents. */\n',
  'export function totalWithTax(items: readonly Item[], rate: number): number {\n',
  '  const net = total(items)\n',
  '  const gross = net * (1 + rate)\n',
  '  return Math.round(gross * 100) / 100\n',
  '}\n',
  '\n',
]

/** Where the streamed function goes: after the first blank line, so code below has to move. */
export function streamInsertOffset(text: string): number {
  const blank = text.indexOf('\n\n')
  return blank < 0 ? text.length : blank + 2
}
