import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { runMutation } from '@/lib/mutations/run'

describe('runMutation', () => {
  it('runs same-scope mutations serially and records them in the cache', async () => {
    const queryClient = new QueryClient()
    const order: string[] = []
    const options = (name: string) => ({
      mutationFn: async () => {
        order.push(`${name}:start`)
        await new Promise((resolve) => setTimeout(resolve, 5))
        order.push(`${name}:end`)
        return name
      },
      mutationKey: ['test', name],
      scope: { id: 'serial' },
    })

    const results = await Promise.all([
      runMutation(queryClient, options('a'), undefined),
      runMutation(queryClient, options('b'), undefined),
    ])

    expect(results).toEqual(['a', 'b'])
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end'])
    expect(queryClient.getMutationCache().findAll({ mutationKey: ['test'] })).toHaveLength(2)
  })

  it('passes the query client to the mutation function context', async () => {
    const queryClient = new QueryClient()
    const seen = await runMutation(
      queryClient,
      { mutationFn: (_variables: void, context) => Promise.resolve(context.client) },
      undefined,
    )

    expect(seen).toBe(queryClient)
  })

  it('lets a settled mutation leave the cache', async () => {
    const queryClient = new QueryClient()
    const options = { gcTime: 0, mutationFn: () => Promise.resolve('done'), mutationKey: ['gc'] }

    await runMutation(queryClient, options, undefined)
    await runMutation(queryClient, options, undefined)
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(queryClient.getMutationCache().findAll({ mutationKey: ['gc'] })).toHaveLength(0)
  })
})
