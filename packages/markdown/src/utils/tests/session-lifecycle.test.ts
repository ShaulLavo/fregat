import { setImmediate } from 'node:timers/promises'
import { assert, beforeAll, expect, test } from 'vitest'

import { MARKDOWN_CASES } from '../../../test/fixtures/cases'
import { createMarkdownSession, type MarkdownSessionFactory } from '../session'
import {
  createTreeSitterMarkdownSession,
  initializeTreeSitterMarkdown,
} from '../tree-sitter-session'

const ROOT = Symbol('markdown-session-lifecycle')
const engines = [
  { engine: 'remark', factory: createMarkdownSession },
  { engine: 'tree-sitter', factory: createTreeSitterMarkdownSession },
] satisfies readonly { engine: string; factory: MarkdownSessionFactory }[]
const modes = engines.flatMap((engine) => [
  { ...engine, heal: false },
  { ...engine, heal: true },
])

beforeAll(() => initializeTreeSitterMarkdown())

function source() {
  const fixture = MARKDOWN_CASES.find((entry) => entry.id === 'two-paragraphs')
  assert(fixture)
  return fixture.source
}

function rootObjects() {
  const objects = Array.from({ length: 1000 }, (_, index) => ({ index }))
  Reflect.defineProperty(globalThis, ROOT, { configurable: true, value: objects })
  return objects.map((object) => new WeakRef(object))
}

function rootClearedSession(factory: MarkdownSessionFactory, heal: boolean) {
  const session = factory()
  Reflect.defineProperty(globalThis, ROOT, { configurable: true, value: session })
  const blocks = session.update(source(), { heal })
  expect(blocks).toHaveLength(2)
  expect(blocks.map((block) => block.settled)).toEqual([true, false])
  const references = blocks.map((block) => new WeakRef(block))
  expect(session.update('', { heal })).toEqual([])
  return references
}

function alive(references: readonly WeakRef<object>[]) {
  return references.filter((reference) => reference.deref() !== undefined).length
}

async function collectAfterUnwind(collect: () => void) {
  // WeakRef targets remain alive until the current JavaScript job ends.
  await setImmediate()
  collect()
}

test.for(modes)(
  '$engine empty update preserves reset behavior with heal=$heal',
  ({ factory, heal }) => {
    const session = factory()
    const first = session.update(source(), { heal })
    const appended = session.update(source() + ' More.', { heal })
    expect(appended[0]).toBe(first[0])
    expect(session.update(source() + ' More.', { heal })).toBe(appended)
    const empty = session.update('', { heal })
    expect(empty).toEqual([])
    expect(session.update('', { heal })).toBe(empty)
    expect(session.update('', { heal: !heal })).toEqual([])
    const restarted = session.update(source(), { heal })
    expect(restarted).toEqual(factory().update(source(), { heal }))
    expect(restarted[0]).not.toBe(first[0])
  },
)

test.for(modes)(
  '$engine empty update releases old blocks with heal=$heal while alive',
  async ({ factory, heal }, context) => {
    const collect = globalThis.gc
    if (!collect) {
      context.skip('GC is unavailable; run Node with --expose-gc to check reachability')
      return
    }
    try {
      const controls = rootObjects()
      await collectAfterUnwind(collect)
      expect(alive(controls)).toBe(1000)
      Reflect.deleteProperty(globalThis, ROOT)
      await collectAfterUnwind(collect)
      expect(alive(controls)).toBe(0)

      const blocks = rootClearedSession(factory, heal)
      await collectAfterUnwind(collect)
      expect(typeof Reflect.get(globalThis, ROOT)?.update).toBe('function')
      expect(alive(blocks)).toBe(0)
      Reflect.deleteProperty(globalThis, ROOT)
      await collectAfterUnwind(collect)
      expect(alive(blocks)).toBe(0)
    } finally {
      Reflect.deleteProperty(globalThis, ROOT)
    }
  },
)
