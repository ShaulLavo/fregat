import { afterEach, vi } from 'vitest'
import { expect, test } from '../../../../../test/fixtures'
import { loadedMermaid, mermaidQueryOptions, setMermaidLoader } from '@/features/chat/state/mermaid'
import { resourceQueryClient } from '@/lib/resources/state/query-client'

afterEach(() => setMermaidLoader(null))

test('concurrent fences share acquisition and a failed library can be requested again', async () => {
  let attempts = 0
  setMermaidLoader(async () => {
    attempts += 1
    if (attempts === 1) throw new Error('fixture import failure')
    return { initialize() {}, render: async () => ({ svg: '<svg />' }) }
  })
  const failed = await Promise.allSettled([
    resourceQueryClient.query(mermaidQueryOptions),
    resourceQueryClient.query(mermaidQueryOptions),
  ])
  expect(failed.map((result) => result.status)).toEqual(['rejected', 'rejected'])
  expect(attempts).toBe(1)
  expect(loadedMermaid()).toBeNull()
  expect(resourceQueryClient.getQueryState(mermaidQueryOptions.queryKey)?.status).toBe('error')
  const renderer = await resourceQueryClient.query(mermaidQueryOptions)
  expect(loadedMermaid()).toBe(renderer)
  expect(attempts).toBe(2)
})

test('renderer configuration remains owned by its diagram until rendering settles', async () => {
  let theme: unknown
  const gate = Promise.withResolvers<void>()
  const render = vi.fn(async (_id: string, text: string) => {
    if (text === 'first') await gate.promise
    return { svg: `${text}:${theme}` }
  })
  setMermaidLoader(async () => ({
    initialize: (config) => {
      theme = config.theme
    },
    render,
  }))
  const renderer = await resourceQueryClient.query(mermaidQueryOptions)
  const first = renderer.render('first', 'dark')
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1))
  const second = renderer.render('second', 'light')
  await Promise.resolve()
  expect(render).toHaveBeenCalledTimes(1)
  gate.resolve()
  expect(await first).toBe('first:dark')
  expect(await second).toBe('second:default')
})
