/*
 * Where the standard library comes from, with the network off.
 *
 * `fetch` is stubbed to throw for the whole file. That is the assertion, not a precaution: the
 * milestone this suite closes is "the tests can build a language service with the network off", and
 * a stub that throws is the only way to prove no code path quietly dialled out.
 */

import { createWorkerLspTransport, LspClient } from '@singapore-editor/lsp'
import ts from 'typescript'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as lsp from 'vscode-languageserver-protocol'
import { createTypeScriptLanguageSession } from '../src/worker/session'
import { InProcessTypeScriptWorker } from './inProcessWorker'
import {
  createRealTypeScriptService,
  typeScriptLibraryFilesFromDisk,
} from './realTypeScriptService'

const FIXTURE_FILE_NAME = '/src/fixture.ts'
const FIXTURE_SOURCE = `export type Shape = {
  readonly kind: 'circle' | 'square'
  readonly size: number
}

export interface Renderer {
  render(shape: Shape): string
}

export class ConsoleRenderer implements Renderer {
  #prefix: string

  constructor(prefix: string) {
    this.#prefix = prefix
  }

  render(shape: Shape): string {
    return \`\${this.#prefix}:\${shape.kind}:\${shape.size}\`
  }
}

export const renderAll = (renderer: Renderer, shapes: readonly Shape[]): string[] =>
  shapes.map((shape) => renderer.render(shape))
`

// Anything that reaches the network from inside a test is a bug, so say so where it is thrown —
// the message is what the CDN assertion below matches on.
const OFFLINE_MESSAGE = 'the TypeScript LSP suites must not reach the network'
const offlineFetch = vi.fn((_input: unknown): never => {
  throw new Error(OFFLINE_MESSAGE)
})

describe('a real TypeScript language service, offline', () => {
  beforeAll(() => {
    vi.stubGlobal('fetch', offlineFetch)
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    offlineFetch.mockClear()
  })

  it('builds a service from the lib files installed on disk', () => {
    const libraries = typeScriptLibraryFilesFromDisk()
    const env = createRealTypeScriptService(new Map([[FIXTURE_FILE_NAME, FIXTURE_SOURCE]]))

    expect(libraries.get('/lib.es5.d.ts')).toContain('interface Array<T>')
    expect(env.getSourceFile(FIXTURE_FILE_NAME)?.text).toBe(FIXTURE_SOURCE)
    expect(env.languageService.getSemanticDiagnostics(FIXTURE_FILE_NAME)).toEqual([])
    expect(offlineFetch).not.toHaveBeenCalled()
  })

  it('classifies a fixture into whole triples of encoded spans', () => {
    const env = createRealTypeScriptService(new Map([[FIXTURE_FILE_NAME, FIXTURE_SOURCE]]))

    const { spans } = env.languageService.getEncodedSemanticClassifications(
      FIXTURE_FILE_NAME,
      ts.createTextSpan(0, FIXTURE_SOURCE.length),
      ts.SemanticClassificationFormat.TwentyTwenty,
    )

    expect(spans.length).toBeGreaterThan(0)
    expect(spans.length % 3).toBe(0)
    expect(offlineFetch).not.toHaveBeenCalled()
  })

  it('builds the session service from a lib loader instead of fetching', async () => {
    const worker = new InProcessTypeScriptWorker()
    const client = await connectedClient(worker)
    await client.notify('editor/typescript/setWorkspaceFiles', {
      files: [{ path: 'src/fixture.ts', text: FIXTURE_SOURCE }],
    })

    const tokens = await client.request<lsp.SemanticTokens>('textDocument/semanticTokens/full', {
      textDocument: { uri: 'file:///src/fixture.ts' },
    })

    expect(offlineFetch).not.toHaveBeenCalled()
    expect(tokens.data.length).toBeGreaterThan(0)
    worker.terminate()
  })

  it('loads the bundled standard library with the network off', async () => {
    const posted: unknown[] = []
    const session = createTypeScriptLanguageSession({ post: (message) => posted.push(message) })
    session.receive({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    session.receive({
      jsonrpc: '2.0',
      method: 'editor/typescript/setWorkspaceFiles',
      params: { files: [{ path: 'src/fixture.ts', text: FIXTURE_SOURCE }] },
    })
    session.receive({
      jsonrpc: '2.0',
      id: 2,
      method: 'textDocument/diagnostic',
      params: { textDocument: { uri: 'file:///src/fixture.ts' } },
    })

    await vi.waitFor(() => expect(posted).toHaveLength(2), { timeout: 10_000 })
    expect(posted[1]).toMatchObject({ id: 2, result: { kind: 'full', items: [] } })
    expect(offlineFetch).not.toHaveBeenCalled()
    session.dispose()
  })

  it('fetches the standard library from the CDN only when the host opts in', async () => {
    const posted: unknown[] = []
    const session = createTypeScriptLanguageSession({ post: (message) => posted.push(message) })
    session.receive({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { initializationOptions: { libraryFiles: 'cdn' } },
    })
    session.receive({
      jsonrpc: '2.0',
      method: 'editor/typescript/setWorkspaceFiles',
      params: { files: [{ path: 'src/fixture.ts', text: FIXTURE_SOURCE }] },
    })
    session.receive({
      jsonrpc: '2.0',
      id: 2,
      method: 'textDocument/hover',
      params: {
        textDocument: { uri: 'file:///src/fixture.ts' },
        position: { line: 0, character: 13 },
      },
    })

    await vi.waitFor(() => expect(posted).toHaveLength(2))
    expect(posted[1]).toMatchObject({ id: 2, error: { message: OFFLINE_MESSAGE } })
    expect(String(offlineFetch.mock.calls[0]?.[0])).toContain(
      `playgroundcdn.typescriptlang.org/cdn/${ts.version}/typescript/lib/lib.`,
    )
    session.dispose()
  })
})

async function connectedClient(worker: InProcessTypeScriptWorker): Promise<LspClient> {
  const client = new LspClient({ rootUri: 'file:///' })
  await client.connect(createWorkerLspTransport(worker))
  return client
}
