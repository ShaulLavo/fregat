import { readFile, writeFile } from 'node:fs/promises'
import { createViewerDocument } from '@/viewer/state/document'
import { createViewerDraftCache } from '@/viewer/state/drafts'
import { test, expect } from '../../../test/fixtures'
import { createTestSettingsSession } from '../../../test/factories/session'

test('conflict drafts survive session closure and retain their original snapshot until discarded', async ({
  server,
}) => {
  await writeFile(`${server.root}/sample.ts`, 'original\n')
  const firstSession = createTestSettingsSession(server)
  await firstSession.refresh()
  const first = createViewerDocument({
    session: firstSession,
    rootPath: '',
    path: 'sample.ts',
    editText: async () => {
      await writeFile(`${server.root}/sample.ts`, 'agent changed this file\n')
      return 'external editor draft\n'
    },
  })
  await first.open()
  const original = first.getSnapshot()
  if (original.kind !== 'ready') return expect.unreachable('Expected original document')
  await first.edit()
  first.dispose()
  await firstSession.flush()
  firstSession.dispose()

  const secondSession = createTestSettingsSession(server)
  await secondSession.refresh()
  const inputs: string[] = []
  let result = 'retrying the saved draft\n'
  const reopened = createViewerDocument({
    session: secondSession,
    rootPath: '',
    path: 'sample.ts',
    editText: async ({ text }) => {
      inputs.push(text)
      return result
    },
  })
  try {
    await reopened.open()
    expect(reopened.getSnapshot()).toMatchObject({
      kind: 'ready',
      file: { content: 'agent changed this file\n' },
      draft: {
        text: 'external editor draft\n',
        expected: { mtimeMs: original.file.mtimeMs, version: original.file.version },
      },
    })
    const restored = reopened.getSnapshot()
    if (restored.kind !== 'ready') return expect.unreachable('Expected restored draft')
    expect(restored.error).toContain('draft was restored')
    await reopened.edit()
    expect(inputs).toEqual(['external editor draft\n'])
    expect(await readFile(`${server.root}/sample.ts`, 'utf8')).toBe('agent changed this file\n')
    expect(reopened.getSnapshot()).toMatchObject({
      draft: { text: result, expected: { version: original.file.version } },
    })
    await reopened.reload()
    expect(reopened.getSnapshot()).toMatchObject({ draft: null, error: null })
    result = 'explicit edit after reloading current disk\n'
    await reopened.edit()
    expect(inputs.at(-1)).toBe('agent changed this file\n')
    expect(await readFile(`${server.root}/sample.ts`, 'utf8')).toBe(result)
    const ready = secondSession.getSnapshot()
    if (ready.kind !== 'ready') return expect.unreachable('Expected ready session')
    expect(ready.storage.keys('viewer:draft:')).toEqual([])
  } finally {
    reopened.dispose()
    secondSession.dispose()
  }
})

test('draft caches isolate roots and preserve a newer draft when an older viewer clears its own', async ({
  server,
}) => {
  const session = createTestSettingsSession(server)
  await session.refresh()
  const ready = session.getSnapshot()
  if (ready.kind !== 'ready') return expect.unreachable('Expected ready storage')
  const first = createViewerDraftCache(ready.storage, 'first-root', 'file.ts')
  const second = createViewerDraftCache(ready.storage, 'second-root', 'file.ts')
  const old = { text: 'old', expected: { mtimeMs: 1, version: 'old-version' } }
  const newer = { text: 'newer draft', expected: { mtimeMs: 1, version: 'old-version' } }
  try {
    await first.save(old)
    expect(second.read()).toBeNull()
    await first.save(newer)
    await first.remove(old)
    expect(first.read()).toEqual(newer)
  } finally {
    session.dispose()
  }
})
