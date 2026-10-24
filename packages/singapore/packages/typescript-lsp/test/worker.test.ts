/*
 * The session's own protocol, driven raw: a client here is whatever the test sends, so it can be one
 * that never declares pull diagnostics, or one that answers the worker's own requests by hand.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as lsp from 'vscode-languageserver-protocol'
import {
  DELETE_WORKSPACE_FILES,
  LIBRARY_FILES_REQUEST,
  SET_WORKSPACE_FILES,
  UPSERT_WORKSPACE_FILES,
} from '../src/worker/customMethods'
import { createTypeScriptLanguageSession } from '../src/worker/session'
import { libraryFilesFromDisk } from './realTypeScriptService'

type Message = Record<string, unknown>

type RawSession = {
  readonly posted: Message[]
  send(message: Message): void
  request<T>(method: string, params?: unknown): Promise<T>
  notify(method: string, params?: unknown): void
  dispose(): void
}

const sessions: RawSession[] = []

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose()
})

function rawSession(options: { readonly disk?: boolean } = {}): RawSession {
  const posted: Message[] = []
  const session = createTypeScriptLanguageSession({
    post: (message) => posted.push(message as Message),
    ...(options.disk === false
      ? {}
      : { readLibraryFiles: (names) => Promise.resolve(libraryFilesFromDisk(names)) }),
  })
  let nextId = 1
  const raw: RawSession = {
    posted,
    send: (message) => session.receive(message),
    notify: (method, params) => session.receive({ jsonrpc: '2.0', method, params }),
    request: async <T>(method: string, params?: unknown) => {
      const id = nextId++
      session.receive({ jsonrpc: '2.0', id, method, params })
      const response = await waitFor(() => posted.find((message) => message.id === id))
      if (response.error) throw new Error(JSON.stringify(response.error))
      return response.result as T
    },
    dispose: () => session.dispose(),
  }
  sessions.push(raw)
  return raw
}

async function initialize(
  session: RawSession,
  initializationOptions: Record<string, unknown> = {},
): Promise<void> {
  await session.request('initialize', {
    capabilities: {},
    initializationOptions: { diagnosticDelayMs: 0, ...initializationOptions },
  })
}

function open(session: RawSession, uri: string, text: string, version = 0): void {
  session.notify('textDocument/didOpen', {
    textDocument: { uri, languageId: 'typescript', version, text },
  })
}

function diagnosticCodes(session: RawSession, uri: string): Promise<unknown[]> {
  return session
    .request<lsp.FullDocumentDiagnosticReport>('textDocument/diagnostic', {
      textDocument: { uri },
    })
    .then((report) => report.items.map((item) => item.code))
}

describe('TypeScript worker session', () => {
  it('uses a dirty logical package document as the canonical symbol for rename and diagnostics', async () => {
    const session = rawSession()
    const canonical = '/repo/src/lib.ts'
    const alias = '/repo/node_modules/pkg/index.ts'
    await initialize(session, {
      canonicalPaths: { [alias]: canonical },
      compilerOptions: { noLib: true, preserveSymlinks: false, moduleResolution: 2 },
    })
    session.notify(SET_WORKSPACE_FILES, {
      files: [
        { path: canonical, text: 'export const value = 1' },
        { path: alias, text: 'export const value = 1' },
        { path: '/repo/node_modules/pkg/package.json', text: '{"types":"index.ts"}' },
        { path: '/repo/main.ts', text: 'import { value } from "pkg"; value' },
      ],
    })
    open(session, `file://${alias}`, 'export const value: string = "dirty"', 4)
    const edits = await session.request<lsp.WorkspaceEdit>('textDocument/rename', {
      textDocument: { uri: `file://${alias}` },
      position: { line: 0, character: 14 },
      newName: 'next',
    })
    expect(JSON.stringify(edits)).toContain('file:///repo/main.ts')
    session.notify(UPSERT_WORKSPACE_FILES, {
      files: [
        { path: '/repo/main.ts', text: 'import { value } from "pkg"; const n: number = value' },
      ],
    })
    expect(await diagnosticCodes(session, 'file:///repo/main.ts')).toContain(2322)
  })
  it('pushes diagnostics to a client that does not pull', async () => {
    const session = rawSession()
    await initialize(session)
    open(session, 'file:///src/index.ts', 'const value: string = 1;')

    const published = await waitFor(() =>
      session.posted.find((message) => message.method === 'textDocument/publishDiagnostics'),
    )

    expect(published.params).toMatchObject({
      uri: 'file:///src/index.ts',
      version: 0,
      diagnostics: [
        {
          severity: 1,
          code: 2322,
          source: 'typescript',
          range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
        },
      ],
    })
  })

  it('reads compiler options from the workspace tsconfig', async () => {
    const session = rawSession()
    await initialize(session)
    session.notify(SET_WORKSPACE_FILES, {
      files: [
        { path: 'tsconfig.json', text: JSON.stringify({ compilerOptions: { strict: false } }) },
        { path: 'src/index.ts', text: 'export function take(value) { return value }' },
      ],
    })

    expect(await diagnosticCodes(session, 'file:///src/index.ts')).not.toContain(7006)
  })

  it('resolves a workspace package through its mirror and answers with the workspace path', async () => {
    const session = rawSession()
    await initialize(session)
    session.notify(SET_WORKSPACE_FILES, {
      files: [
        {
          path: 'packages/core/package.json',
          text: JSON.stringify({ name: '@repo/core', exports: { '.': './src/index.ts' } }),
        },
        { path: 'packages/core/src/index.ts', text: 'export const answer = 42;' },
      ],
    })
    open(session, 'file:///app/main.ts', "import { answer } from '@repo/core'\nanswer\n")

    const definition = await session.request<lsp.Location[]>('textDocument/definition', {
      textDocument: { uri: 'file:///app/main.ts' },
      position: { line: 1, character: 1 },
    })

    expect(definition).toEqual([
      {
        uri: 'file:///packages/core/src/index.ts',
        range: { start: { line: 0, character: 13 }, end: { line: 0, character: 19 } },
      },
    ])
  })

  it('applies upserted and deleted files to the running program', async () => {
    const session = rawSession()
    await initialize(session)
    session.notify(SET_WORKSPACE_FILES, {
      files: [{ path: 'src/shape.ts', text: 'export const size = 1' }],
    })
    open(
      session,
      'file:///src/main.ts',
      "import { size } from './shape'\nconst text: string = size\n",
    )
    const codes = () => diagnosticCodes(session, 'file:///src/main.ts')

    expect(await codes()).toEqual([2322, 6133])

    session.notify(UPSERT_WORKSPACE_FILES, {
      files: [{ path: 'src/shape.ts', text: "export const size = 'one'" }],
    })
    expect(await codes()).toEqual([6133])

    session.notify(DELETE_WORKSPACE_FILES, { paths: ['src/shape.ts'] })
    expect(await codes()).toContain(2307)

    session.notify(UPSERT_WORKSPACE_FILES, {
      files: [{ path: 'src/shape.ts', text: 'export const size = 2' }],
    })
    expect(await codes()).toEqual([2322, 6133])
  })

  it('carries an upsert inside a workspace package to the package its importers resolve', async () => {
    const session = rawSession()
    await initialize(session)
    session.notify(SET_WORKSPACE_FILES, {
      files: [
        {
          path: 'packages/core/package.json',
          text: JSON.stringify({ name: '@repo/core', exports: { '.': './src/index.ts' } }),
        },
        { path: 'packages/core/src/index.ts', text: 'export const answer = 42' },
      ],
    })
    open(
      session,
      'file:///app/main.ts',
      "import { answer } from '@repo/core'\nexport const text: string = answer\n",
    )
    expect(await diagnosticCodes(session, 'file:///app/main.ts')).toEqual([2322])

    session.notify(UPSERT_WORKSPACE_FILES, {
      files: [{ path: 'packages/core/src/index.ts', text: "export const answer = 'forty-two'" }],
    })

    expect(await diagnosticCodes(session, 'file:///app/main.ts')).toEqual([])
  })

  it('rebuilds the program when an upsert changes the tsconfig', async () => {
    const session = rawSession()
    await initialize(session)
    session.notify(SET_WORKSPACE_FILES, {
      files: [
        { path: 'tsconfig.json', text: JSON.stringify({ compilerOptions: { strict: true } }) },
        { path: 'src/index.ts', text: 'export function take(value) { return value }' },
      ],
    })
    expect(await diagnosticCodes(session, 'file:///src/index.ts')).toContain(7006)

    session.notify(UPSERT_WORKSPACE_FILES, {
      files: [
        { path: 'tsconfig.json', text: JSON.stringify({ compilerOptions: { strict: false } }) },
      ],
    })

    expect(await diagnosticCodes(session, 'file:///src/index.ts')).not.toContain(7006)
  })

  it('asks the host for library files when the host supplies them', async () => {
    const session = rawSession({ disk: false })
    await initialize(session, { libraryFiles: 'host' })
    open(session, 'file:///src/index.ts', 'export const count: number = [1].length')
    const asked: string[] = []
    const answered = new Set<unknown>()
    const answerLibraryRequests = setInterval(() => {
      for (const message of session.posted) {
        if (message.method !== LIBRARY_FILES_REQUEST || answered.has(message.id)) continue
        answered.add(message.id)
        const names = (message.params as { names: string[] }).names
        asked.push(...names)
        session.send({
          jsonrpc: '2.0',
          id: message.id,
          result: { files: Object.fromEntries(libraryFilesFromDisk(names)) },
        })
      }
    }, 0)

    const codes = await diagnosticCodes(session, 'file:///src/index.ts')
    clearInterval(answerLibraryRequests)

    expect(codes).toEqual([])
    expect(asked).toContain('lib.es2023.full.d.ts')
    expect(asked).toContain('lib.es5.d.ts')
    expect(asked.length).toBeLessThan(108)
  })

  it('fails with a reason when the host answers the library request without files', async () => {
    const session = rawSession({ disk: false })
    await initialize(session, { libraryFiles: 'host' })
    open(session, 'file:///src/index.ts', 'export const count = 1')
    const pending = session.request('textDocument/hover', {
      textDocument: { uri: 'file:///src/index.ts' },
      position: { line: 0, character: 14 },
    })
    const asked = await waitFor(() =>
      session.posted.find((message) => message.method === LIBRARY_FILES_REQUEST),
    )

    session.send({ jsonrpc: '2.0', id: asked.id, result: null })

    await expect(pending).rejects.toThrow(/answered editor\/typescript\/libraryFiles without files/)
  })

  it('gives up on a host that never answers and asks again on the next request', async () => {
    vi.useFakeTimers()
    try {
      const posted: Message[] = []
      const session = createTypeScriptLanguageSession({
        post: (message) => posted.push(message as Message),
      })
      session.receive({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { initializationOptions: { libraryFiles: 'host' } },
      })
      const hover = (id: number) =>
        session.receive({
          jsonrpc: '2.0',
          id,
          method: 'textDocument/hover',
          params: {
            textDocument: { uri: 'file:///src/a.ts' },
            position: { line: 0, character: 0 },
          },
        })
      session.receive({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: 'file:///src/a.ts',
            languageId: 'typescript',
            version: 0,
            text: 'x',
          },
        },
      })
      const libraryRequests = () =>
        posted.filter((message) => message.method === LIBRARY_FILES_REQUEST)

      hover(2)
      await vi.advanceTimersByTimeAsync(0)
      expect(libraryRequests()).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(posted.find((message) => message.id === 2)).toMatchObject({
        error: { message: 'The host did not answer editor/typescript/libraryFiles' },
      })

      hover(3)
      await vi.advanceTimersByTimeAsync(0)
      expect(libraryRequests()).toHaveLength(2)
      session.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})

async function waitFor<T>(find: () => T | undefined): Promise<T> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const found = find()
    if (found !== undefined) return found
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('Timed out waiting for the session')
}

it.each(['file:///repo/src/lib.ts', 'file:///repo/node_modules/pkg/index.ts'])(
  'keeps the surviving open URI and canonical disk source after closing %s',
  async (closed) => {
    const session = rawSession()
    const canonical = '/repo/src/lib.ts'
    const alias = '/repo/node_modules/pkg/index.ts'
    await initialize(session, {
      canonicalPaths: { [alias]: canonical },
      compilerOptions: { noLib: true, moduleResolution: 2 },
    })
    session.notify(SET_WORKSPACE_FILES, {
      files: [
        { path: canonical, text: 'export const value = 1' },
        { path: alias, text: 'export const value = 1' },
        {
          path: '/repo/main.ts',
          text: 'import { value } from "./src/lib"; const n: number = value',
        },
      ],
    })
    open(session, `file://${canonical}`, 'export const value: string = "dirty"')
    open(session, `file://${alias}`, 'export const value: string = "dirty"')
    expect(await diagnosticCodes(session, 'file:///repo/main.ts')).toContain(2322)
    session.notify('textDocument/didClose', { textDocument: { uri: closed } })
    expect(await diagnosticCodes(session, 'file:///repo/main.ts')).toContain(2322)
    const remaining = closed === `file://${canonical}` ? `file://${alias}` : `file://${canonical}`
    session.notify('textDocument/didClose', { textDocument: { uri: remaining } })
    expect(await diagnosticCodes(session, 'file:///repo/main.ts')).not.toContain(2322)
    session.notify(DELETE_WORKSPACE_FILES, { paths: [alias] })
    expect(await diagnosticCodes(session, 'file:///repo/main.ts')).not.toContain(2307)
  },
)

it('invalidates an existing package import after its alias is deleted and resolves it after re-creation', async () => {
  const session = rawSession()
  const canonical = '/repo/src/lib.ts'
  const alias = '/repo/node_modules/pkg/index.ts'
  await initialize(session, {
    canonicalPaths: { [alias]: canonical },
    compilerOptions: { noLib: true, moduleResolution: 2 },
  })
  session.notify(SET_WORKSPACE_FILES, {
    files: [
      { path: canonical, text: 'export const value = 1' },
      { path: alias, text: 'export const value = 1' },
      { path: '/repo/node_modules/pkg/package.json', text: '{"types":"index.ts"}' },
      { path: '/repo/main.ts', text: 'import { value } from "pkg"; value' },
    ],
  })
  expect(await diagnosticCodes(session, 'file:///repo/main.ts')).not.toContain(2307)
  session.notify(DELETE_WORKSPACE_FILES, { paths: [alias] })
  expect(await diagnosticCodes(session, 'file:///repo/main.ts')).toContain(2307)
  session.notify(UPSERT_WORKSPACE_FILES, {
    files: [{ path: alias, text: 'export const value = 1' }],
  })
  expect(await diagnosticCodes(session, 'file:///repo/main.ts')).not.toContain(2307)
})
