import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises'
import { createViewerDocument } from '@/viewer/state/document'
import { test, expect } from '../../../test/fixtures'
import { createTestSettingsSession } from '../../../test/factories/session'

test('editing a nested workspace writes the selected file even when a duplicate matches its snapshot', async ({
  server,
}) => {
  await mkdir(`${server.root}/project/project`, { recursive: true })
  for (const path of ['project/sample.ts', 'project/project/sample.ts']) {
    await writeFile(`${server.root}/${path}`, 'original')
    await utimes(`${server.root}/${path}`, 1700000000, 1700000000)
  }
  const session = createTestSettingsSession(server)
  await session.refresh()
  const document = createViewerDocument({
    session,
    rootPath: 'project',
    path: 'project/sample.ts',
    editText: async () => 'edited',
  })
  try {
    await document.open()
    await document.edit()
    expect(await readFile(`${server.root}/project/sample.ts`, 'utf8')).toBe('edited')
    expect(await readFile(`${server.root}/project/project/sample.ts`, 'utf8')).toBe('original')
    expect(document.getSnapshot()).toMatchObject({
      draft: null,
      error: null,
      file: { content: 'edited' },
    })
  } finally {
    document.dispose()
    session.dispose()
  }
})

test('editing outside the current workspace preserves the draft without writing either file', async ({
  server,
}) => {
  await mkdir(`${server.root}/project`)
  for (const path of ['sample.ts', 'project/sample.ts']) {
    await writeFile(`${server.root}/${path}`, 'original')
    await utimes(`${server.root}/${path}`, 1700000000, 1700000000)
  }
  const session = createTestSettingsSession(server)
  await session.refresh()
  const document = createViewerDocument({
    session,
    rootPath: 'project',
    path: 'sample.ts',
    editText: async () => 'edited',
  })
  try {
    await document.open()
    await document.edit()
    expect(await readFile(`${server.root}/sample.ts`, 'utf8')).toBe('original')
    expect(await readFile(`${server.root}/project/sample.ts`, 'utf8')).toBe('original')
    expect(document.getSnapshot()).toMatchObject({
      draft: { text: 'edited' },
      error: expect.stringContaining('outside the current workspace'),
    })
  } finally {
    document.dispose()
    session.dispose()
  }
})

test('external edit preserves the native filename and commits through workspace-edit', async ({
  server,
}) => {
  await writeFile(`${server.root}/sample.ts`, 'const answer = 1\n')
  const session = createTestSettingsSession(server)
  await session.refresh()
  const filenames: (string | undefined)[] = []
  const document = createViewerDocument({
    session,
    rootPath: '',
    path: 'sample.ts',
    editText: async (request) => {
      filenames.push(request.filename)
      return 'const answer = 42\n'
    },
  })
  try {
    await document.open()
    await document.edit()
    expect(filenames).toEqual(['sample.ts'])
    expect(await readFile(`${server.root}/sample.ts`, 'utf8')).toBe('const answer = 42\n')
    expect(document.getSnapshot()).toMatchObject({
      kind: 'ready',
      draft: null,
      error: null,
      file: { content: 'const answer = 42\n' },
    })
    const recovery = await session.client.fs['workspace-edit'].recovery.get({
      query: { workspace: '' },
    })
    expect(recovery.data).toMatchObject({ operations: [] })
  } finally {
    document.dispose()
    session.dispose()
  }
})

test('concurrent disk edits reject the stale snapshot and keep the external draft', async ({
  server,
}) => {
  await writeFile(`${server.root}/sample.ts`, 'original\n')
  const session = createTestSettingsSession(server)
  await session.refresh()
  const document = createViewerDocument({
    session,
    rootPath: '',
    path: 'sample.ts',
    editText: async () => {
      await writeFile(`${server.root}/sample.ts`, 'agent changed the file\n')
      return 'external editor draft\n'
    },
  })
  try {
    await document.open()
    await document.edit()
    expect(await readFile(`${server.root}/sample.ts`, 'utf8')).toBe('agent changed the file\n')
    expect(document.getSnapshot()).toMatchObject({
      kind: 'ready',
      draft: { text: 'external editor draft\n' },
      editing: false,
    })
    const snapshot = document.getSnapshot()
    if (snapshot.kind !== 'ready') return expect.unreachable('Expected a readable stale snapshot')
    expect(snapshot.error).toContain('Draft kept')
    await document.reload()
    expect(document.getSnapshot()).toMatchObject({
      kind: 'ready',
      draft: null,
      file: { content: 'agent changed the file\n' },
    })
  } finally {
    document.dispose()
    session.dispose()
  }
})

test('closing a viewer during handoff never writes the returned text', async ({ server }) => {
  await writeFile(`${server.root}/sample.ts`, 'original\n')
  const session = createTestSettingsSession(server)
  await session.refresh()
  const handoff = Promise.withResolvers<string>()
  const document = createViewerDocument({
    session,
    rootPath: '',
    path: 'sample.ts',
    editText: () => handoff.promise,
  })
  await document.open()
  const editing = document.edit()
  document.dispose()
  handoff.resolve('late edit\n')
  await editing
  expect(await readFile(`${server.root}/sample.ts`, 'utf8')).toBe('original\n')
  session.dispose()
})
