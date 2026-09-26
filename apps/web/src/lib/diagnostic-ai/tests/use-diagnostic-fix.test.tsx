import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, test } from 'vitest'

import { useDiagnosticFix } from '@/lib/diagnostic-ai/hooks/use-diagnostic-fix'
import { DiagnosticFixContext } from '@/lib/diagnostic-ai/providers/context'
import type { DiagnosticFixRequest } from '@/lib/diagnostic-ai/utils/prompt'
import { createTestQueryClient } from '../../../../test/render'

const request: DiagnosticFixRequest = {
  path: 'repo/app.ts',
  message: 'Fix this',
  code: null,
  severity: 1,
  source: null,
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
  surface: 'problems',
}

test('Fix with AI queues requests from separate diagnostic surfaces', async () => {
  const client = createTestQueryClient()
  const first = Promise.withResolvers<boolean>()
  const entered: string[] = []
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <DiagnosticFixContext
          value={async (input) => {
            entered.push(input.message)
            if (input.message === 'first') return first.promise
            return true
          }}
        >
          {children}
        </DiagnosticFixContext>
      </QueryClientProvider>
    )
  }
  const a = renderHook(useDiagnosticFix, { wrapper })
  const b = renderHook(useDiagnosticFix, { wrapper })
  let one: Promise<boolean>, two: Promise<boolean>
  act(() => {
    one = a.result.current.mutation.mutateAsync({ ...request, message: 'first' })
    two = b.result.current.mutation.mutateAsync({ ...request, message: 'second' })
  })
  try {
    await waitFor(() => expect(a.result.current.mutation.isPending).toBe(true))
    expect(entered).toEqual(['first'])
    expect(b.result.current.mutation.isPaused).toBe(true)
  } finally {
    first.resolve(true)
    await act(async () => {
      await Promise.all([one, two])
    })
    client.clear()
  }
  expect(entered).toEqual(['first', 'second'])
})

test('an unavailable draft destination rejects the mutation', async () => {
  const client = createTestQueryClient()
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <DiagnosticFixContext value={async () => false}>{children}</DiagnosticFixContext>
      </QueryClientProvider>
    )
  }
  const hook = renderHook(useDiagnosticFix, { wrapper })
  await act(async () => {
    await expect(hook.result.current.mutation.mutateAsync(request)).rejects.toMatchObject({
      message: 'The chat draft could not be opened.',
    })
  })
  client.clear()
})
