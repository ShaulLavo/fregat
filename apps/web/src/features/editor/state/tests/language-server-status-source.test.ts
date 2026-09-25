import { summarizeDiagnostics } from '@singapore-editor/lsp-plugin/diagnostics'

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
  expect(source.getSnapshot().failedServerIds).toEqual(['secondary'])
  expect(messages(source)).toEqual(['primary'])
})

test('names lanes still connecting while another already answers', () => {
  const source = createEditorLanguageServerStatusSource()
  source.setServers(['fast', 'slow'])
  source.setServerStatus('fast', 'ready')
  source.setServerDiagnostics('fast', summary('fast'))

  expect(source.getSnapshot()).toMatchObject({
    failedServerIds: [],
    pendingServerIds: ['slow'],
    status: 'ready',
  })
  source.setServerStatus('slow', 'ready')
  expect(source.getSnapshot().pendingServerIds).toEqual([])
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

test('adopts relayed server states without clobbering servers it owns itself', () => {
  const shared = createEditorLanguageServerStatusSource()
  shared.setServers(['eslint'])
  const target = createEditorLanguageServerStatusSource()
  target.setServers(['eslint', 'typescript-worker'])
  target.setServerStatus('typescript-worker', 'ready')
  target.setServerInteractiveReady('typescript-worker')
  target.setServerDiagnostics('typescript-worker', summary('worker'))

  shared.setServerStatus('eslint', 'ready')
  shared.setServerDiagnostics('eslint', summary('lint'))
  target.setServerStates(shared.getServerStates())

  expect(messages(target).toSorted()).toEqual(['lint', 'worker'])
  target.setServerStatus('typescript-worker', 'error')
  target.setServerStates(shared.getServerStates())
  expect(target.getSnapshot().failedServerIds).toEqual(['typescript-worker'])
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
