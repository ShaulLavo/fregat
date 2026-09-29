/*
 * E054's parity harness: one scripted session against the worker's real TypeScript service, asking
 * for every method the server path answers and recording what came back.
 *
 * A row is `supported` only when the capability is advertised and the answer carries something a
 * feature can use. A capability the worker advertises without a row here fails the harness, so a
 * new capability arrives with its row or not at all — which is how an advertised-but-unhandled
 * method (the pull-diagnostics error E054 started from) gets caught.
 */

import {
  createWorkerLspTransport,
  LspClient,
  LspResponseError,
  METHOD_NOT_FOUND,
  offsetToLspPosition,
  semanticTokensClientCapability,
} from '@singapore-editor/lsp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type * as lsp from 'vscode-languageserver-protocol'
import { InProcessTypeScriptWorker } from './inProcessWorker'

const SHAPES_URI = 'file:///src/shapes.ts'
const MAIN_URI = 'file:///src/main.ts'

const SHAPES = `export interface Shape {
  area(): number
}

/** A circle, measured by its radius. */
export class Circle implements Shape {
  constructor(readonly radius: number) {}

  area(): number {
    return Math.PI * this.radius ** 2
  }
}

export function describe(shape: Shape, label: string): string {
  return \`\${label}: \${shape.area()}\`
}
`

const MAIN = `import { Circle, describe } from './shapes'

const circle = new Circle(2)
const total: number = describe(circle, 'circle')
const   spaced   =   1
console.log(total, spaced, circl)
`

/** Appended by the scripted edit, so every later answer is about the edited document. */
const EDIT = `const   packed   =   3;
circle.ar`

type Row = {
  readonly method: string
  /** The server capability that announces the method, as a path into `ServerCapabilities`. */
  readonly capability: string
  run(session: Session): Promise<unknown>
  /** Whether the answer carries what the feature asking for it needs. */
  useful(result: unknown): boolean
}

type Session = {
  readonly client: LspClient
  readonly main: () => string
  at(text: string, marker: string, delta?: number): lsp.Position
  diagnostics(): Promise<lsp.Diagnostic[]>
}

const ROWS: readonly Row[] = [
  {
    method: 'textDocument/hover',
    capability: 'hoverProvider',
    run: (s) =>
      s.client.request('textDocument/hover', positionIn(MAIN_URI, s.at(s.main(), 'circle ='))),
    useful: (result) => hoverText(result).includes('const circle: Circle'),
  },
  {
    method: 'textDocument/definition',
    capability: 'definitionProvider',
    run: (s) =>
      s.client.request('textDocument/definition', positionIn(MAIN_URI, s.at(s.main(), 'Circle(2'))),
    useful: (result) => locations(result).some((location) => location.uri === SHAPES_URI),
  },
  {
    method: 'textDocument/references',
    capability: 'referencesProvider',
    run: (s) =>
      s.client.request('textDocument/references', {
        ...positionIn(MAIN_URI, s.at(s.main(), 'circle =')),
        context: { includeDeclaration: true },
      }),
    useful: (result) => locations(result).length >= 3,
  },
  {
    method: 'textDocument/implementation',
    capability: 'implementationProvider',
    run: (s) =>
      s.client.request(
        'textDocument/implementation',
        positionIn(SHAPES_URI, s.at(SHAPES, 'Shape {')),
      ),
    useful: (result) => locations(result).length > 0,
  },
  {
    method: 'textDocument/typeDefinition',
    capability: 'typeDefinitionProvider',
    run: (s) =>
      s.client.request(
        'textDocument/typeDefinition',
        positionIn(MAIN_URI, s.at(s.main(), 'circle =')),
      ),
    useful: (result) => locations(result).some((location) => location.uri === SHAPES_URI),
  },
  {
    method: 'textDocument/completion',
    capability: 'completionProvider',
    run: (s) => completionAtEdit(s),
    useful: (result) => completionItems(result).some((item) => item.label === 'area'),
  },
  {
    method: 'completionItem/resolve',
    capability: 'completionProvider.resolveProvider',
    run: async (s) => {
      const area = completionItems(await completionAtEdit(s)).find((item) => item.label === 'area')
      return s.client.request('completionItem/resolve', area)
    },
    useful: (result) => (result as lsp.CompletionItem).detail?.includes('Circle.area') === true,
  },
  {
    method: 'textDocument/signatureHelp',
    capability: 'signatureHelpProvider',
    run: (s) =>
      s.client.request(
        'textDocument/signatureHelp',
        positionIn(MAIN_URI, s.at(s.main(), "'circle'")),
      ),
    useful: (result) => {
      const help = result as lsp.SignatureHelp | null
      return (
        help?.signatures[0]?.label.startsWith('describe(') === true && help.activeParameter === 1
      )
    },
  },
  {
    method: 'textDocument/documentHighlight',
    capability: 'documentHighlightProvider',
    run: (s) =>
      s.client.request(
        'textDocument/documentHighlight',
        positionIn(MAIN_URI, s.at(s.main(), 'circle =')),
      ),
    useful: (result) => Array.isArray(result) && result.length >= 3,
  },
  {
    method: 'textDocument/documentSymbol',
    capability: 'documentSymbolProvider',
    run: (s) =>
      s.client.request('textDocument/documentSymbol', { textDocument: { uri: SHAPES_URI } }),
    useful: (result) => {
      const circle = (result as lsp.DocumentSymbol[]).find((symbol) => symbol.name === 'Circle')
      return circle?.children?.some((child) => child.name === 'area') === true
    },
  },
  {
    method: 'workspace/symbol',
    capability: 'workspaceSymbolProvider',
    run: (s) => s.client.request('workspace/symbol', { query: 'Circ' }),
    useful: (result) =>
      (result as lsp.SymbolInformation[]).some(
        (symbol) => symbol.name === 'Circle' && symbol.location.uri === SHAPES_URI,
      ),
  },
  {
    method: 'textDocument/prepareRename',
    capability: 'renameProvider.prepareProvider',
    run: (s) =>
      s.client.request(
        'textDocument/prepareRename',
        positionIn(MAIN_URI, s.at(s.main(), 'Circle(2')),
      ),
    useful: (result) => (result as { placeholder?: string } | null)?.placeholder === 'Circle',
  },
  {
    method: 'textDocument/rename',
    capability: 'renameProvider',
    // From the declaration: renamed at an import's use, TypeScript aliases the import instead.
    run: (s) =>
      s.client.request('textDocument/rename', {
        ...positionIn(SHAPES_URI, s.at(SHAPES, 'Circle implements')),
        newName: 'Round',
      }),
    useful: (result) => {
      const uris = editedUris(result as lsp.WorkspaceEdit | null)
      return uris.includes(MAIN_URI) && uris.includes(SHAPES_URI)
    },
  },
  {
    method: 'textDocument/codeAction',
    capability: 'codeActionProvider',
    run: async (s) => {
      const diagnostics = await s.diagnostics()
      const misspelled = diagnostics.filter((diagnostic) => diagnostic.code === 2552)
      return s.client.request('textDocument/codeAction', {
        textDocument: { uri: MAIN_URI },
        range: misspelled[0]?.range,
        context: { diagnostics: misspelled, only: ['quickfix'] },
      })
    },
    useful: (result) =>
      (result as lsp.CodeAction[]).some(
        (action) =>
          action.isPreferred === true && action.title.includes("'circle'") && !!action.edit,
      ),
  },
  {
    method: 'codeAction/resolve',
    capability: 'codeActionProvider.resolveProvider',
    run: async (s) => {
      const start = s.at(s.main(), 'new Circle(2)')
      const end = s.at(s.main(), 'new Circle(2)', 'new Circle(2)'.length)
      const actions = await s.client.request<lsp.CodeAction[]>('textDocument/codeAction', {
        textDocument: { uri: MAIN_URI },
        range: { start, end },
        context: { diagnostics: [], only: ['refactor.extract'], triggerKind: 1 },
      })
      const extract = actions.find((action) => !action.edit)
      return extract ? s.client.request('codeAction/resolve', extract) : null
    },
    useful: (result) =>
      editedUris((result as lsp.CodeAction | null)?.edit ?? null).includes(MAIN_URI),
  },
  {
    method: 'textDocument/formatting',
    capability: 'documentFormattingProvider',
    run: (s) =>
      s.client.request('textDocument/formatting', {
        textDocument: { uri: MAIN_URI },
        options: { tabSize: 2, insertSpaces: true },
      }),
    useful: (result) => Array.isArray(result) && result.length > 0,
  },
  {
    method: 'textDocument/rangeFormatting',
    capability: 'documentRangeFormattingProvider',
    run: (s) => {
      const line = s.at(s.main(), 'const   spaced').line
      return s.client.request('textDocument/rangeFormatting', {
        textDocument: { uri: MAIN_URI },
        range: { start: { line, character: 0 }, end: { line: line + 1, character: 0 } },
        options: { tabSize: 2, insertSpaces: true },
      })
    },
    useful: (result) => Array.isArray(result) && result.length > 0,
  },
  {
    method: 'textDocument/onTypeFormatting',
    capability: 'documentOnTypeFormattingProvider',
    run: (s) =>
      s.client.request('textDocument/onTypeFormatting', {
        ...positionIn(MAIN_URI, s.at(s.main(), '3;', 2)),
        ch: ';',
        options: { tabSize: 2, insertSpaces: true },
      }),
    useful: (result) => Array.isArray(result) && result.length > 0,
  },
  {
    method: 'textDocument/diagnostic',
    capability: 'diagnosticProvider',
    run: (s) => s.client.request('textDocument/diagnostic', { textDocument: { uri: MAIN_URI } }),
    useful: (result) => {
      const report = result as lsp.DocumentDiagnosticReport
      return (
        report.kind === 'full' && typeof report.resultId === 'string' && report.items.length > 0
      )
    },
  },
  {
    method: 'textDocument/semanticTokens/full',
    capability: 'semanticTokensProvider.full',
    run: (s) =>
      s.client.request('textDocument/semanticTokens/full', { textDocument: { uri: MAIN_URI } }),
    useful: (result) => (result as lsp.SemanticTokens).data.length > 0,
  },
  {
    method: 'textDocument/semanticTokens/range',
    capability: 'semanticTokensProvider.range',
    run: (s) =>
      s.client.request('textDocument/semanticTokens/range', {
        textDocument: { uri: MAIN_URI },
        range: { start: { line: 2, character: 0 }, end: { line: 4, character: 0 } },
      }),
    useful: (result) => (result as lsp.SemanticTokens).data.length > 0,
  },
]

/** Capabilities that announce no request of their own. */
const NOT_REQUESTS = new Set(['textDocumentSync'])

describe('TypeScript worker parity with the server path', () => {
  let worker: InProcessTypeScriptWorker
  let client: LspClient
  let mainText = MAIN

  beforeAll(async () => {
    worker = new InProcessTypeScriptWorker()
    const semanticTokens = semanticTokensClientCapability({ requests: { full: true, range: true } })
    client = new LspClient({
      rootUri: 'file:///',
      timeoutMs: 20_000,
      initializationOptions: { diagnosticDelayMs: 0 },
      capabilities: {
        textDocument: {
          ...semanticTokens.textDocument,
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
        },
        workspace: { workspaceEdit: { documentChanges: true } },
      },
    })
    await client.connect(createWorkerLspTransport(worker))
    await client.notify('editor/typescript/setWorkspaceFiles', {
      files: [{ path: 'src/shapes.ts', text: SHAPES }],
    })
    await client.notify('textDocument/didOpen', {
      textDocument: { uri: MAIN_URI, languageId: 'typescript', version: 1, text: MAIN },
    })
    const end = offsetToLspPosition(MAIN, MAIN.length)
    mainText = `${MAIN}${EDIT}`
    await client.notify('textDocument/didChange', {
      textDocument: { uri: MAIN_URI, version: 2 },
      contentChanges: [{ range: { start: end, end }, text: EDIT }],
    })
  }, 30_000)

  afterAll(() => {
    client.disconnect()
    worker.terminate()
  })

  it('answers every row the server path answers', async () => {
    const session: Session = {
      client,
      main: () => mainText,
      at: positionOf,
      diagnostics: async () => {
        const report = await client.request<lsp.DocumentDiagnosticReport>(
          'textDocument/diagnostic',
          {
            textDocument: { uri: MAIN_URI },
          },
        )
        return report.kind === 'full' ? report.items : []
      },
    }

    const table = []
    for (const row of ROWS) table.push(`| ${row.method} | ${await answer(client, session, row)} |`)

    expect(table.join('\n')).toBe(ROWS.map((row) => `| ${row.method} | supported |`).join('\n'))
  }, 30_000)

  it('has a row for every capability it advertises', () => {
    const covered = new Set(ROWS.map((row) => row.capability.split('.')[0]))
    const advertised = Object.keys(client.serverCapabilities ?? {}).filter(
      (key) => !NOT_REQUESTS.has(key),
    )

    expect(advertised.filter((key) => !covered.has(key))).toEqual([])
  })
})

async function answer(client: LspClient, session: Session, row: Row): Promise<string> {
  if (!capabilityAdvertised(client.serverCapabilities, row.capability)) return 'not advertised'

  try {
    const result = await row.run(session)
    return row.useful(result) ? 'supported' : `unusable: ${JSON.stringify(result)?.slice(0, 200)}`
  } catch (error) {
    if (error instanceof LspResponseError && error.code === METHOD_NOT_FOUND) {
      return 'advertised, not handled'
    }
    return `error: ${error instanceof Error ? error.message : String(error)}`
  }
}

function capabilityAdvertised(capabilities: lsp.ServerCapabilities | null, path: string): boolean {
  let value: unknown = capabilities
  for (const key of path.split('.')) {
    if (typeof value !== 'object' || value === null) return false
    value = (value as Record<string, unknown>)[key]
  }
  return value !== undefined && value !== false && value !== null
}

function completionAtEdit(session: Session): Promise<lsp.CompletionList> {
  const text = session.main()
  return session.client.request('textDocument/completion', {
    ...positionIn(MAIN_URI, offsetToLspPosition(text, text.length)),
    context: { triggerKind: 1 },
  })
}

function positionOf(text: string, marker: string, delta = 0): lsp.Position {
  const offset = text.indexOf(marker)
  if (offset === -1) throw new Error(`Fixture has no "${marker}"`)
  return offsetToLspPosition(text, offset + delta)
}

function positionIn(uri: string, position: lsp.Position): lsp.TextDocumentPositionParams {
  return { textDocument: { uri }, position }
}

function hoverText(result: unknown): string {
  const contents = (result as lsp.Hover | null)?.contents
  if (!contents || typeof contents !== 'object' || !('value' in contents)) return ''
  return contents.value
}

function locations(result: unknown): readonly lsp.Location[] {
  return Array.isArray(result) ? (result as lsp.Location[]) : []
}

function completionItems(result: unknown): readonly lsp.CompletionItem[] {
  return (result as lsp.CompletionList | null)?.items ?? []
}

function editedUris(edit: lsp.WorkspaceEdit | null): readonly string[] {
  if (!edit) return []
  if (edit.changes) return Object.keys(edit.changes)
  return (edit.documentChanges ?? []).flatMap((change) =>
    'textDocument' in change ? [change.textDocument.uri] : [],
  )
}
