import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'
import { instrumentSource } from './ghostty-x6-source-ledger.ts'

interface Fixture {
  run(flag: boolean): unknown
  statements(): number
  chain(value?: { child(): { read(): number } }): number | undefined
  nested(): number
}

const source = `
class Item {}
function run(flag: boolean) {
  if (!flag) return 0
  const build = () => new Item()
  const values = [{ item: build() }]
  return Object.freeze(values)
}
function statements() {
  let calls = 0
  const bump = () => { calls++ }
  bump()
  bump()
  if (calls === 2) bump()
  else bump()
  return calls
}
function chain(value?: { child(): { read(): number } }) {
  return value?.child().read()
}
const receiver = { value: 7, child() { return { read: () => this.value } } }
function nested() { return receiver.child().read() }
;(globalThis as any).fixture = { run, statements, chain, nested }
`

it('counts observable factories and preserves ASI, receivers and optional chains', () => {
  const result = instrumentSource('fixture.ts', source)
  const context = {
    __x6Owned: {} as Record<string, number>,
    fixture: undefined as Fixture | undefined,
  }
  runInNewContext(new Bun.Transpiler({ loader: 'ts' }).transformSync(result.source), context)
  context.__x6Owned = {}
  expect(context.fixture!.run(false)).toBe(0)
  expect(context.__x6Owned).toEqual({})
  context.fixture!.run(true)
  const totals: Record<string, number> = {}
  for (const site of result.sites) {
    const count = context.__x6Owned[site.id] ?? 0
    if (count) totals[site.kind] = (totals[site.kind] ?? 0) + count
  }
  expect(totals).toEqual({
    ArrowFunctionExpression: 1,
    NewExpression: 1,
    ArrayExpression: 1,
    ObjectExpression: 1,
    CallExpression: 2,
  })
  expect(context.fixture!.statements()).toBe(3)
  expect(context.fixture!.chain()).toBeUndefined()
  expect(context.fixture!.chain({ child: () => ({ read: () => 9 }) })).toBe(9)
  expect(context.fixture!.nested()).toBe(7)
  expect(new Set(result.sites.map((site) => site.id)).size).toBe(result.sites.length)
  const nestedCalls = result.sites.filter(
    (site) => site.kind === 'CallExpression' && site.text.startsWith('receiver.child()'),
  )
  expect(nestedCalls).toHaveLength(2)
  expect(nestedCalls[0]!.start).toBe(nestedCalls[1]!.start)
  expect(nestedCalls[0]!.end).not.toBe(nestedCalls[1]!.end)
  expect(nestedCalls[0]!.id).not.toBe(nestedCalls[1]!.id)
})
