import path from 'node:path'
import { expect, test } from 'vitest'
import type { TestSpecification, Vitest } from 'vitest/node'
import durations from './shard-durations.json'
import DurationSequencer from './shard-sequencer'

const root = path.join(import.meta.dirname, '..')
const recorded = Object.keys(durations)
const files = [...recorded, 'src/features/new-feature/tests/unrecorded.test.ts'].map(
  (key) => ({ moduleId: path.join(root, key) }) as TestSpecification,
)

async function shardsOf(count: number) {
  const shards: TestSpecification[][] = []
  for (let index = 1; index <= count; index += 1) {
    const context = { config: { root, shard: { count, index } } } as unknown as Vitest
    shards.push(await new DurationSequencer(context).shard(files))
  }
  return shards
}

test('every file lands in exactly one shard, recorded or not', async () => {
  const shards = await shardsOf(4)
  const assigned = shards.flat().map((spec) => spec.moduleId)

  expect(assigned).toHaveLength(files.length)
  expect(new Set(assigned)).toEqual(new Set(files.map((spec) => spec.moduleId)))
})

test('the shards carry about the same recorded time', async () => {
  const seconds = (shard: TestSpecification[]) =>
    shard.reduce(
      (sum, spec) =>
        sum + (durations[path.relative(root, spec.moduleId) as keyof typeof durations] ?? 0),
      0,
    )
  const loads = (await shardsOf(4)).map(seconds)

  expect(Math.max(...loads) - Math.min(...loads)).toBeLessThan(
    Math.max(...Object.values(durations)),
  )
})
