import { assert, TestRunner, type RunnerTestCase } from 'vitest'

const owners = new WeakMap<RunnerTestCase, Set<() => void>>()

export function registerRequestOwner(stop: () => void) {
  const test = TestRunner.getCurrentTest()
  assert(test, 'Request owners must be registered during a test.')
  const existing = owners.get(test) ?? new Set<() => void>()
  existing.add(stop)
  owners.set(test, existing)
}

export function stopRequestOwners(test: RunnerTestCase) {
  const registered = owners.get(test)
  owners.delete(test)
  for (const stop of registered ?? []) stop()
}
