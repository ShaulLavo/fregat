import { QueryClient } from '@tanstack/react-query'

import { spellingSuggestionsQueryOptions } from '@/features/editor/utils/spelling-query'
import { createTestEditorRuntime } from '../../../../../test/factories/editor-runtime'
import { expect, test } from '../../../../../test/fixtures'

test('refreshes cached suggestions when accepted words are added and removed', async () => {
  const client = new QueryClient()
  const runtime = createTestEditorRuntime(client)
  const options = {
    ...spellingSuggestionsQueryOptions(null, { word: 'fregatt', start: 0, end: 7 }),
    queryFn: async () => (runtime.spellcheck.isAccepted('fregat') ? ['fregat'] : []),
  }
  try {
    expect(await client.query(options)).toEqual([])
    runtime.spellcheck.setAcceptedWords(['fregat'])
    await Promise.resolve()
    expect(await client.query(options)).toEqual(['fregat'])
    runtime.spellcheck.setAcceptedWords([])
    await Promise.resolve()
    expect(await client.query(options)).toEqual([])
  } finally {
    runtime.dispose()
    client.clear()
  }
})

test('a suggestion reply from the old dictionary cannot refill the cache', async () => {
  const client = new QueryClient()
  const runtime = createTestEditorRuntime(client)
  const reply = Promise.withResolvers<readonly string[]>()
  const options = {
    ...spellingSuggestionsQueryOptions(null, { word: 'fregatt', start: 0, end: 7 }),
    queryFn: () => reply.promise,
  }
  try {
    const pending = client.query(options).catch(() => undefined)
    runtime.spellcheck.setAcceptedWords(['fregat'])
    await Promise.resolve()
    reply.resolve([])
    await pending
    expect(await client.query({ ...options, queryFn: async () => ['fregat'] })).toEqual(['fregat'])
  } finally {
    runtime.dispose()
    client.clear()
  }
})
