import { expect, it } from 'vitest'
import { TreeSitterWorkerClient, canUseTreeSitterWorker } from '../src'

it('reports null retention when workers are unsupported without starting one', async () => {
  expect(canUseTreeSitterWorker()).toBe(false)
  const client = new TreeSitterWorkerClient()
  try {
    await client.registerLanguages([])
    expect(await client.inspectRetention()).toBeNull()
    expect(client.inspect()).toMatchObject({
      lifecycle: 'idle',
      workerGeneration: 0,
      pendingRequests: 0,
    })
  } finally {
    await client.dispose()
  }
  expect(await client.inspectRetention()).toBeNull()
})
