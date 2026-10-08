import path from 'node:path'
import { beforeAll, expect, it } from 'vitest'
import { loadIdentityAdapter } from './identity-adapter.mjs'
import { makeFixtures } from './fixtures.mjs'
import { packageRoot } from './support.mjs'
import { prepareState, runOperations, validate } from './worker.mjs'

let factory
beforeAll(async () => {
  factory = await loadIdentityAdapter(path.join(packageRoot, 'dist'))
})

it.each(
  makeFixtures('smoke', 42).filter((fixture) =>
    ['load', 'edit', 'query', 'history', 'branches'].includes(fixture.mode),
  ),
)('identity adapter validates the same string oracle for $name', (fixture) => {
  const context = fixture.mode === 'load' ? null : prepareState(factory, fixture)
  const result = runOperations(factory, fixture, context)
  expect(() => validate(factory, fixture, result)).not.toThrow()
})
