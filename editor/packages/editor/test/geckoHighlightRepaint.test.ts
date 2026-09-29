import { afterEach, describe, expect, it } from 'vitest'
import {
  reregisterHighlights,
  scheduleHighlightRepaintNudge,
  setHighlightRepaintNudgeEnabled,
} from '../src/virtualization/geckoHighlightRepaint'
import type { HighlightRegistry } from '../src/virtualization/virtualizedTextViewTypes'

type RegistryOp = readonly [op: 'set' | 'delete', name: string]

function createFakeRegistry(names: readonly string[]) {
  const map = new Map<string, Highlight>()
  for (const name of names) map.set(name, { name } as unknown as Highlight)
  const ops: RegistryOp[] = []
  const registry: HighlightRegistry = {
    set(name, highlight) {
      ops.push(['set', name])
      map.set(name, highlight)
    },
    delete(name) {
      ops.push(['delete', name])
      return map.delete(name)
    },
    entries: () => map.entries(),
  }
  return { registry, map, ops }
}

function flushMicrotasks(): Promise<void> {
  return Promise.resolve()
}

afterEach(() => {
  setHighlightRepaintNudgeEnabled(null)
})

describe('reregisterHighlights', () => {
  it('re-sets every entry preserving order and identity', () => {
    const { registry, map, ops } = createFakeRegistry(['token-0', 'token-1', 'token-2'])
    const before = Array.from(map.entries())

    reregisterHighlights(registry)

    expect(Array.from(map.entries())).toEqual(before)
    expect(ops).toEqual([
      ['delete', 'token-0'],
      ['delete', 'token-1'],
      ['delete', 'token-2'],
      ['set', 'token-0'],
      ['set', 'token-1'],
      ['set', 'token-2'],
    ])
  })

  it('ignores registries without entries enumeration', () => {
    const registry: HighlightRegistry = { set: () => {}, delete: () => true }
    expect(() => reregisterHighlights(registry)).not.toThrow()
  })
})

describe('scheduleHighlightRepaintNudge', () => {
  it('coalesces multiple schedules into one re-register per registry', async () => {
    setHighlightRepaintNudgeEnabled(true)
    const { registry, ops } = createFakeRegistry(['token-0', 'token-1'])

    scheduleHighlightRepaintNudge(registry)
    scheduleHighlightRepaintNudge(registry)
    scheduleHighlightRepaintNudge(registry)
    expect(ops).toEqual([])

    await flushMicrotasks()
    expect(ops).toHaveLength(4)

    scheduleHighlightRepaintNudge(registry)
    await flushMicrotasks()
    expect(ops).toHaveLength(8)
  })

  it('does nothing when the engine does not need the nudge', async () => {
    setHighlightRepaintNudgeEnabled(false)
    const { registry, ops } = createFakeRegistry(['token-0'])

    scheduleHighlightRepaintNudge(registry)
    await flushMicrotasks()
    expect(ops).toEqual([])
  })

  it('does nothing for null or non-enumerable registries', async () => {
    setHighlightRepaintNudgeEnabled(true)
    scheduleHighlightRepaintNudge(null)

    const ops: RegistryOp[] = []
    const bare: HighlightRegistry = {
      set: (name) => {
        ops.push(['set', name])
      },
      delete: (name) => {
        ops.push(['delete', name])
        return true
      },
    }
    scheduleHighlightRepaintNudge(bare)
    await flushMicrotasks()
    expect(ops).toEqual([])
  })
})
