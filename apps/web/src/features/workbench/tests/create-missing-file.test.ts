import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { QueryClient } from '@tanstack/react-query'
import { createMissingFileOptions } from '@/features/workbench/utils/create-missing-file'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { registerEnvironmentQueryClient } from '@/lib/environments/state/query-clients'
import { runMutation } from '@/lib/mutations/run'
import { fileSystemKeys } from '@/lib/query-keys'
import { expect, test } from '../../../../test/fixtures'

test('creates a missing file and parents, then invalidates the filesystem snapshot', async ({
  client,
  server,
}) => {
  const path = filesystemPath('missing/parent/note.txt')
  const queries = new QueryClient()
  registerEnvironmentQueryClient(queries, 'http://localhost:7077', client)
  queries.setQueryData(fileSystemKeys.fileMetadata(path), { path })
  try {
    await runMutation(queries, createMissingFileOptions(queries, path), undefined)
    expect(await readFile(join(server.root, path), 'utf8')).toBe('')
    expect(queries.getQueryState(fileSystemKeys.fileMetadata(path))?.isInvalidated).toBe(true)
  } finally {
    queries.clear()
  }
})

test('Create File refuses to overwrite content restored by another process', async ({
  client,
  server,
}) => {
  const path = filesystemPath('note.txt')
  const queries = new QueryClient()
  registerEnvironmentQueryClient(queries, 'http://localhost:7077', client)
  await writeFile(join(server.root, path), 'restored elsewhere')
  try {
    await expect(
      runMutation(queries, createMissingFileOptions(queries, path), undefined),
    ).rejects.toBeDefined()
    expect(await readFile(join(server.root, path), 'utf8')).toBe('restored elsewhere')
  } finally {
    queries.clear()
  }
})
