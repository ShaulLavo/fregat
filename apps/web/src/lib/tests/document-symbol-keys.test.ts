import { QueryClient } from '@tanstack/react-query'
import { expect, test } from 'vitest'

import { documentSymbolKeys } from '@/lib/query-keys'

test('the palette rows and the breadcrumb tree for one revision are cached apart', () => {
  const client = new QueryClient()
  const flat = documentSymbolKeys.document('/repo', 'src/a.ts', 'ts:3', 'flat')
  const tree = documentSymbolKeys.document('/repo', 'src/a.ts', 'ts:3', 'tree')
  client.setQueryData(flat, [{ name: 'a', containerName: null }])
  client.setQueryData(tree, [{ name: 'a', children: [] }])

  expect(client.getQueryData(flat)).toEqual([{ name: 'a', containerName: null }])
  expect(client.getQueryData(tree)).toEqual([{ name: 'a', children: [] }])
  expect(client.getQueryCache().findAll({ queryKey: documentSymbolKeys.all })).toHaveLength(2)
})
