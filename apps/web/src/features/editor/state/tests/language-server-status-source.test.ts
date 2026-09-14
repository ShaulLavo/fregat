import { summarizeDiagnostics } from '@singapore-editor/lsp-plugin'

import { createEditorLanguageServerStatusSource } from '@/features/editor/state/language-server-status-source'
import { expect, test } from '../../../../../test/fixtures'

test('aggregates readiness and preserves diagnostics from healthy lanes', () => {
  const source = createEditorLanguageServerStatusSource()
  source.setServers(['primary', 'secondary'])

  expect(source.getSnapshot()).toMatchObject({ diagnostics: null, status: 'loading' })
  source.setServerStatus('primary', 'ready')
  expect(source.getSnapshot().status).toBe('loading')

  source.setServerDiagnostics('primary', summary('primary'))
  source.setServerDiagnostics('secondary', summary('secondary'))
  expect(source.getSnapshot().status).toBe('ready')
  expect(messages(source)).toEqual(['primary', 'secondary'])

  source.setServerStatus('secondary', 'error')
  expect(source.getSnapshot().status).toBe('ready')
  expect(messages(source)).toEqual(['primary'])
})

test('reports error only after every eligible lane errors', () => {
  const source = createEditorLanguageServerStatusSource()
  source.setServers(['first', 'second'])
  source.setServerStatus('first', 'error')

  expect(source.getSnapshot().status).toBe('loading')
  source.setServerStatus('second', 'error')
  expect(source.getSnapshot().status).toBe('error')
  source.setServers([])
  expect(source.getSnapshot().status).toBe('idle')
})

test('takes aggregate metadata from the first non-empty diagnostic batch', () => {
  const source = createEditorLanguageServerStatusSource()
  source.setServers(['closed', 'current'])
  source.setServerDiagnostics('closed', summarizeDiagnostics('file:///closed.ts', 1, []))
  source.setServerDiagnostics('current', summary('current', 'file:///current.ts', 2))

  expect(source.getSnapshot().diagnostics).toMatchObject({
    uri: 'file:///current.ts',
    version: 2,
  })
  expect(messages(source)).toEqual(['current'])
})

test('successful requests do not republish an already usable server', () => {
  const source = createEditorLanguageServerStatusSource()
  source.setServers(['primary'])
  source.setServerStatus('primary', 'ready')
  source.setServerDiagnostics('primary', summary('problem'))
  const snapshot = source.getSnapshot()
  let publications = 0
  const unsubscribe = source.subscribe(() => publications++)

  for (let index = 0; index < 20; index++) source.setServerInteractiveReady('primary')

  expect(source.getSnapshot()).toBe(snapshot)
  expect(publications).toBe(0)

  source.setServerStatus('primary', 'loading')
  source.setServerStatus('primary', 'ready')
  expect(source.getSnapshot().status).toBe('loading')
  source.setServerInteractiveReady('primary')
  expect(source.getSnapshot().status).toBe('ready')
  unsubscribe()
})

function summary(message: string, uri = 'file:///test.ts', version = 1) {
  return summarizeDiagnostics(uri, version, [
    {
      message,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    },
  ])
}

function messages(source: ReturnType<typeof createEditorLanguageServerStatusSource>) {
  return source.getSnapshot().diagnostics?.diagnostics.map((item) => item.message) ?? []
}
