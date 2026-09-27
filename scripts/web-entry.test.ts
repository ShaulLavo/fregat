import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseSync } from 'oxc-parser'
import { expect, test } from 'vitest'

const ENTRY = path.resolve(import.meta.dirname, '../apps/web/src/main.tsx')
const FUNCTION = /Function|ArrowFunctionExpression|MethodDefinition/

/** Every `await` or `for await` that runs while the module itself is still evaluating. */
function topLevelAwaits(node: unknown, found: number[] = []): number[] {
  if (!node || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    for (const child of node) topLevelAwaits(child, found)
    return found
  }
  const record = node as { type?: unknown; start?: number; await?: unknown }
  if (typeof record.type === 'string' && FUNCTION.test(record.type)) return found
  if (record.type === 'AwaitExpression' || (record.type === 'ForOfStatement' && record.await))
    found.push(record.start ?? -1)
  for (const [key, child] of Object.entries(record))
    if (key !== 'parent') topLevelAwaits(child, found)
  return found
}

// Lazy chunks (the phone shell, the terminal panel, settings) import the chunk that holds the
// entry. While the entry sits in a top-level await on one of them, that import never settles:
// the phone shell and a reload with the terminal panel open stayed blank in production.
test('the web entry never awaits at the top level', () => {
  const source = readFileSync(ENTRY, 'utf8')
  const { program, errors } = parseSync(ENTRY, source)
  expect(errors).toEqual([])
  const lines = topLevelAwaits(program.body).map(
    (offset) => source.slice(0, offset).split('\n').length,
  )
  expect(lines, `top-level await on line(s) ${lines.join(', ')} of main.tsx`).toEqual([])
})
