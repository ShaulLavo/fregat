import { expect, test } from './fixtures'
import { productionProbeLifecycle } from './factories/markdown-production'

test('pending production initialization never blocks disposal and late owners are disposed', async () => {
  const pending = Promise.withResolvers<{ dispose(): void }>()
  const lifecycle = productionProbeLifecycle(pending.promise)
  let disposals = 0
  await lifecycle.dispose()
  await lifecycle.dispose()
  expect(lifecycle.current()).toBeNull()
  pending.resolve({
    dispose() {
      disposals++
    },
  })
  await expect(lifecycle.ready).rejects.toThrow('disposed during initialization')
  expect(disposals).toBe(1)
  expect(lifecycle.current()).toBeNull()
})

test('ready production initialization owns exactly one disposal', async () => {
  let disposals = 0
  const owner = {
    dispose() {
      disposals++
    },
  }
  const lifecycle = productionProbeLifecycle(Promise.resolve(owner))
  expect(await lifecycle.ready).toBe(owner)
  expect(lifecycle.current()).toBe(owner)
  await lifecycle.dispose()
  await lifecycle.dispose()
  expect(disposals).toBe(1)
  expect(lifecycle.current()).toBeNull()
})

test('rejected production initialization retains its error and disposal remains independent', async () => {
  const original = new TypeError('fixture initialization failed')
  const lifecycle = productionProbeLifecycle(Promise.reject(original))
  await expect(lifecycle.ready).rejects.toBe(original)
  await lifecycle.dispose()
  expect(lifecycle.current()).toBeNull()
})

test('ready production disposal reports async teardown failure without waiting on readiness', async () => {
  const original = new TypeError('fixture teardown failed')
  const lifecycle = productionProbeLifecycle(
    Promise.resolve({
      dispose: () => Promise.reject(original),
    }),
  )
  await lifecycle.ready
  await expect(lifecycle.dispose()).rejects.toBe(original)
  expect(lifecycle.current()).toBeNull()
  await lifecycle.dispose()
})

test('late production disposal reports async teardown failure through readiness', async () => {
  const original = new TypeError('fixture late teardown failed')
  const pending = Promise.withResolvers<{ dispose(): Promise<void> }>()
  const lifecycle = productionProbeLifecycle(pending.promise)
  await lifecycle.dispose()
  pending.resolve({ dispose: () => Promise.reject(original) })
  await expect(lifecycle.ready).rejects.toBe(original)
  expect(lifecycle.current()).toBeNull()
})
