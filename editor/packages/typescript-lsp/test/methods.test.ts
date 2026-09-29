/*
 * One test per method E054 added to the worker: the answer's shape against the LSP types, and its
 * positions in multi-line files, through the real client and the real TypeScript service.
 */

import {
  createWorkerLspTransport,
  LspClient,
  offsetToLspPosition,
  type LspRequestHandle,
} from '@singapore-editor/lsp'
import { afterEach, describe, expect, it } from 'vitest'
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

  get diameter(): number {
    return this.radius * 2
  }

  area(): number {
    return Math.PI * this.radius ** 2
  }
}

/**
 * Names a shape.
 * @param label What to call it.
 */
export function describe(shape: Shape, label: string): string {
  return \`\${label}: \${shape.area()}\`
}
`

type Harness = {
  readonly client: LspClient
  readonly worker: InProcessTypeScriptWorker
  open(uri: string, text: string, version?: number): Promise<void>
  change(uri: string, text: string, version: number): Promise<void>
}

const harnesses: Harness[] = []

afterEach(() => {
  for (const harness of harnesses.splice(0)) {
    harness.client.disconnect()
    harness.worker.terminate()
  }
})

async function startHarness(
  capabilities: lsp.ClientCapabilities = {},
  serverRequestHandlers: LspClientRequestHandlers = {},
): Promise<Harness> {
  const worker = new InProcessTypeScriptWorker()
  const client = new LspClient({
    rootUri: 'file:///',
    timeoutMs: 20_000,
    initializationOptions: { diagnosticDelayMs: 0 },
    capabilities,
    serverRequestHandlers,
  })
  await client.connect(createWorkerLspTransport(worker))
  await client.notify('editor/typescript/setWorkspaceFiles', {
    files: [{ path: 'src/shapes.ts', text: SHAPES }],
  })
  const harness: Harness = {
    client,
    worker,
    open: (uri, text, version = 1) =>
      client.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'typescript', version, text },
      }),
    change: (uri, text, version) =>
      client.notify('textDocument/didChange', {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      }),
  }
  harnesses.push(harness)
  return harness
}

type LspClientRequestHandlers = NonNullable<
  ConstructorParameters<typeof LspClient>[0]
>['serverRequestHandlers']

describe('pull diagnostics', () => {
  const main = `import { Circle } from './shapes'

const circle: string = new Circle(1)
`

  it('reports a result id and answers unchanged until the project changes', async () => {
    const { client, open, change } = await startHarness()
    await open(MAIN_URI, main)

    const first = await pull(client)
    expect(first).toMatchObject({ kind: 'full', resultId: expect.any(String) })
    if (first.kind !== 'full') throw new Error('expected a full report')
    expect(first.items).toContainEqual(
      expect.objectContaining({ code: 2322, severity: 1, range: rangeOn(2, 6, 12) }),
    )

    expect(await pull(client, first.resultId)).toEqual({
      kind: 'unchanged',
      resultId: first.resultId,
    })

    await change(MAIN_URI, main.replace('string', 'Circle'), 2)
    const third = await pull(client, first.resultId)
    expect(third).toMatchObject({ kind: 'full' })
    if (third.kind !== 'full') throw new Error('expected a full report')
    expect(third.items.map((item) => item.code)).not.toContain(2322)
    expect(third.resultId).not.toBe(first.resultId)
  })

  // Every LspClient declares pull; worker.test.ts covers the push to a client that does not.
  it('pushes nothing to a client that pulls', async () => {
    const { client, worker, open, change } = await startHarness()
    await open(MAIN_URI, main)
    await change(MAIN_URI, main.replace('string', 'Circle'), 2)
    await pull(client)

    expect(published(worker)).toEqual([])
  })

  it('stops a cancelled pull without answering it', async () => {
    const { client, worker, open } = await startHarness()
    await open(MAIN_URI, main)

    const handle: LspRequestHandle<unknown> = client.requestHandle('textDocument/diagnostic', {
      textDocument: { uri: MAIN_URI },
    })
    handle.cancel()
    await expect(handle.response).rejects.toThrow()
    await pull(client)

    expect(responsesTo(worker, handle.id)).toEqual([])
  })

  it('asks a pulling client to refresh when another open document changes', async () => {
    let refreshes = 0
    const { open, change } = await startHarness(
      { workspace: { diagnostics: { refreshSupport: true } }, textDocument: { diagnostic: {} } },
      {
        'workspace/diagnostic/refresh': () => {
          refreshes += 1
          return null
        },
      },
    )
    await open(MAIN_URI, main)
    await open('file:///src/other.ts', 'export const other = 1\n')

    await change('file:///src/other.ts', 'export const other = 2\n', 2)

    await expect.poll(() => refreshes).toBeGreaterThan(0)
  })
})

describe('document symbols', () => {
  it('nests members under their class with name and body ranges', async () => {
    const { client } = await startHarness({
      textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true } },
    })

    const symbols = await client.request<lsp.DocumentSymbol[]>('textDocument/documentSymbol', {
      textDocument: { uri: SHAPES_URI },
    })

    expect(symbols.map((symbol) => [symbol.name, symbol.kind])).toEqual([
      ['Shape', 11],
      ['Circle', 5],
      ['describe', 12],
    ])
    const circle = symbols[1] as lsp.DocumentSymbol
    expect(circle.range).toEqual({
      start: positionOf(SHAPES, 'export class'),
      end: { line: 15, character: 1 },
    })
    expect(circle.selectionRange).toEqual(rangeOf(SHAPES, 'Circle implements', 'Circle'.length))
    expect(circle.children?.map((child) => [child.name, child.kind])).toEqual([
      ['constructor', 9],
      ['radius', 7],
      ['(get) diameter', 7],
      ['area', 6],
    ])
  })

  it('answers a client without tree support with flat symbols that name their container', async () => {
    const { client } = await startHarness()

    const symbols = await client.request<lsp.SymbolInformation[]>('textDocument/documentSymbol', {
      textDocument: { uri: SHAPES_URI },
    })

    expect(symbols).toContainEqual({
      name: 'area',
      kind: 6,
      containerName: 'Circle',
      location: {
        uri: SHAPES_URI,
        range: { start: positionOf(SHAPES, 'area(): number {'), end: { line: 14, character: 3 } },
      },
    })
  })
})

describe('workspace symbols', () => {
  it('finds project symbols and leaves the standard library out', async () => {
    const { client } = await startHarness()

    const symbols = await client.request<lsp.SymbolInformation[]>('workspace/symbol', {
      query: 'area',
    })

    expect(symbols.every((symbol) => symbol.location.uri === SHAPES_URI)).toBe(true)
    expect(symbols).toContainEqual(
      expect.objectContaining({
        name: 'area',
        containerName: 'Circle',
        location: {
          uri: SHAPES_URI,
          range: { start: positionOf(SHAPES, 'area(): number {'), end: { line: 14, character: 3 } },
        },
      }),
    )
  })
})

describe('signature help', () => {
  const main = `import { Circle, describe } from './shapes'

describe(
  new Circle(1),
  'one',
)
`

  it('marks the active parameter by offsets into the label', async () => {
    const { client, open } = await startHarness()
    await open(MAIN_URI, main)

    const help = await client.request<lsp.SignatureHelp>('textDocument/signatureHelp', {
      textDocument: { uri: MAIN_URI },
      position: { line: 4, character: 4 },
      context: { triggerKind: 1, isRetrigger: false },
    })

    const signature = help.signatures[0] as lsp.SignatureInformation
    expect(signature.label).toBe('describe(shape: Shape, label: string): string')
    expect(help.activeParameter).toBe(1)
    const label = signature.parameters?.[1]?.label as [number, number]
    const [start, end] = label
    expect(signature.label.slice(start, end)).toBe('label: string')
    expect(signature.parameters?.[1]?.documentation).toEqual({
      kind: 'markdown',
      value: 'What to call it.',
    })
    expect(signature.documentation).toEqual({ kind: 'markdown', value: 'Names a shape.' })
  })
})

describe('document highlights', () => {
  it('marks writes and reads in this document only', async () => {
    const main = `let count = 0
count += 1
console.log(count)
`
    const { client, open } = await startHarness()
    await open(MAIN_URI, main)

    const highlights = await client.request<lsp.DocumentHighlight[]>(
      'textDocument/documentHighlight',
      {
        textDocument: { uri: MAIN_URI },
        position: { line: 2, character: 13 },
      },
    )

    expect(highlights).toEqual([
      { range: rangeOn(0, 4, 9), kind: 3 },
      { range: rangeOn(1, 0, 5), kind: 3 },
      { range: rangeOn(2, 12, 17), kind: 2 },
    ])
  })
})

describe('rename', () => {
  const main = `import { Circle } from './shapes'

const circle = new Circle(1)
`

  it('prepares with the symbol range and its current name', async () => {
    const { client, open } = await startHarness()
    await open(MAIN_URI, main)

    const prepared = await client.request('textDocument/prepareRename', {
      textDocument: { uri: MAIN_URI },
      position: { line: 2, character: 21 },
    })

    expect(prepared).toEqual({ range: rangeOn(2, 19, 25), placeholder: 'Circle' })
  })

  it('declines a keyword with no prompt', async () => {
    const { client, open } = await startHarness()
    await open(MAIN_URI, main)

    const prepared = await client.request('textDocument/prepareRename', {
      textDocument: { uri: MAIN_URI },
      position: { line: 2, character: 16 },
    })

    expect(prepared).toBeNull()
  })

  it('edits every file, versioning the open one and not the unopened one', async () => {
    const { client, open } = await startHarness({
      workspace: { workspaceEdit: { documentChanges: true } },
    })
    await open(MAIN_URI, main, 7)

    const edit = await client.request<lsp.WorkspaceEdit>('textDocument/rename', {
      textDocument: { uri: SHAPES_URI },
      position: positionOf(SHAPES, 'Circle implements'),
      newName: 'Round',
    })

    expect(edit.documentChanges).toEqual([
      {
        textDocument: { uri: SHAPES_URI, version: null },
        edits: [{ range: rangeOf(SHAPES, 'Circle implements', 'Circle'.length), newText: 'Round' }],
      },
      {
        textDocument: { uri: MAIN_URI, version: 7 },
        edits: [
          { range: rangeOn(0, 9, 15), newText: 'Round' },
          { range: rangeOn(2, 19, 25), newText: 'Round' },
        ],
      },
    ])
  })

  it('answers a client without versioned edits with a changes map', async () => {
    const { client, open } = await startHarness()
    await open(MAIN_URI, main)

    const edit = await client.request<lsp.WorkspaceEdit>('textDocument/rename', {
      textDocument: { uri: MAIN_URI },
      position: { line: 2, character: 7 },
      newName: 'shape',
    })

    expect(edit).toEqual({
      changes: {
        [MAIN_URI]: [{ range: rangeOn(2, 6, 12), newText: 'shape' }],
      },
    })
  })
})

describe('code actions', () => {
  it('offers the spelling fix as the preferred quick fix with its edit', async () => {
    const main = `const circle = 1
console.log(
  circl,
)
`
    const { client, open } = await startHarness()
    await open(MAIN_URI, main)
    const report = await pull(client)
    if (report.kind !== 'full') throw new Error('expected a full report')

    const actions = await client.request<lsp.CodeAction[]>('textDocument/codeAction', {
      textDocument: { uri: MAIN_URI },
      range: rangeOn(2, 2, 7),
      context: { diagnostics: report.items, only: ['quickfix'], triggerKind: 2 },
    })

    expect(actions).toContainEqual(
      expect.objectContaining({
        title: "Change spelling to 'circle'",
        kind: 'quickfix',
        isPreferred: true,
        edit: { changes: { [MAIN_URI]: [{ range: rangeOn(2, 2, 7), newText: 'circle' }] } },
      }),
    )
  })

  it('offers refactors as handles and resolves one into its edit', async () => {
    const main = `export function area(radius: number) {
  return Math.PI * radius ** 2
}
`
    const { client, open } = await startHarness()
    await open(MAIN_URI, main)

    const actions = await client.request<lsp.CodeAction[]>('textDocument/codeAction', {
      textDocument: { uri: MAIN_URI },
      range: rangeOn(1, 9, 30),
      context: { diagnostics: [], only: ['refactor.extract.constant'], triggerKind: 1 },
    })
    const extract = actions[0] as lsp.CodeAction
    expect(extract).toMatchObject({ kind: 'refactor.extract.constant', data: expect.anything() })
    expect(extract.edit).toBeUndefined()

    const resolved = await client.request<lsp.CodeAction>('codeAction/resolve', extract)

    const edits = resolved.edit?.changes?.[MAIN_URI] ?? []
    expect(edits.map((edit) => edit.newText).join('')).toContain(
      'const newLocal = Math.PI * radius ** 2',
    )
  })

  it('computes no refactors for an automatic request', async () => {
    const { client, open } = await startHarness()
    await open(MAIN_URI, 'const value = 1 + 2\n')

    const actions = await client.request('textDocument/codeAction', {
      textDocument: { uri: MAIN_URI },
      range: rangeOn(0, 14, 19),
      context: { diagnostics: [], triggerKind: 2 },
    })

    expect(actions).toEqual([])
  })

  it('organizes imports only when a source action is asked for', async () => {
    const main = `import { describe, Circle } from './shapes'

describe(new Circle(1), 'one')
`
    const { client, open } = await startHarness()
    await open(MAIN_URI, main)
    const range = rangeOn(0, 0, 0)

    const unasked = await client.request<lsp.CodeAction[]>('textDocument/codeAction', {
      textDocument: { uri: MAIN_URI },
      range,
      context: { diagnostics: [], triggerKind: 1 },
    })
    const asked = await client.request<lsp.CodeAction[]>('textDocument/codeAction', {
      textDocument: { uri: MAIN_URI },
      range,
      context: { diagnostics: [], only: ['source.organizeImports'], triggerKind: 1 },
    })

    expect(unasked.some((action) => action.kind === 'source.organizeImports')).toBe(false)
    expect(asked).toEqual([
      {
        title: 'Organize Imports',
        kind: 'source.organizeImports',
        edit: {
          changes: {
            [MAIN_URI]: [
              {
                range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
                newText: "import { Circle, describe } from './shapes'\n",
              },
            ],
          },
        },
      },
    ])
  })
})

describe('formatting', () => {
  const main = 'function f() {\nreturn   1\n}\n'

  it('indents with the width the request names', async () => {
    const { client, open } = await startHarness()
    await open(MAIN_URI, main)

    const four = await format(client, { tabSize: 4, insertSpaces: true })
    const tabs = await format(client, { tabSize: 4, insertSpaces: false })

    expect(applyEdits(main, four)).toBe('function f() {\n    return 1\n}\n')
    expect(applyEdits(main, tabs)).toBe('function f() {\n\treturn 1\n}\n')
  })

  it('keeps a CRLF document on CRLF', async () => {
    const crlf = main.replaceAll('\n', '\r\n')
    const { client, open } = await startHarness()
    await open(MAIN_URI, crlf)

    const edits = await format(client, { tabSize: 2, insertSpaces: true })

    expect(applyEdits(crlf, edits)).toBe('function f() {\r\n  return 1\r\n}\r\n')
  })

  it('formats a range and the line a typed semicolon ends', async () => {
    const text = 'const   a   =   1\nconst   b   =   2;\n'
    const { client, open } = await startHarness()
    await open(MAIN_URI, text)
    const options = { tabSize: 2, insertSpaces: true }

    const range = await client.request<lsp.TextEdit[]>('textDocument/rangeFormatting', {
      textDocument: { uri: MAIN_URI },
      range: rangeOn(0, 0, 17),
      options,
    })
    const typed = await client.request<lsp.TextEdit[]>('textDocument/onTypeFormatting', {
      textDocument: { uri: MAIN_URI },
      position: { line: 1, character: 18 },
      ch: ';',
      options,
    })

    expect(applyEdits(text, range)).toBe('const a = 1\nconst   b   =   2;\n')
    expect(applyEdits(text, typed)).toBe('const   a   =   1\nconst b = 2;\n')
  })
})

describe('completion resolve', () => {
  it('adds the auto-import an entry from another module needs', async () => {
    const main = `const shape = new Circ`
    const { client, open } = await startHarness()
    await open(MAIN_URI, main)

    const list = await client.request<lsp.CompletionList>('textDocument/completion', {
      textDocument: { uri: MAIN_URI },
      position: { line: 0, character: main.length },
      context: { triggerKind: 1 },
    })
    const circle = list.items.find((item) => item.label === 'Circle')
    if (!circle) throw new Error('no Circle completion')

    const resolved = await client.request<lsp.CompletionItem>('completionItem/resolve', circle)

    expect(resolved.detail).toBe('constructor Circle(radius: number): Circle')
    expect(resolved.documentation).toEqual({
      kind: 'markdown',
      value: 'A circle, measured by its radius.',
    })
    expect(resolved.additionalTextEdits).toEqual([
      { range: rangeOn(0, 0, 0), newText: `import { Circle } from "./shapes";\n\n` },
    ])
  })
})

function pull(client: LspClient, previousResultId?: string): Promise<lsp.DocumentDiagnosticReport> {
  return client.request('textDocument/diagnostic', {
    textDocument: { uri: MAIN_URI },
    ...(previousResultId ? { previousResultId } : {}),
  })
}

function format(client: LspClient, options: lsp.FormattingOptions): Promise<lsp.TextEdit[]> {
  return client.request('textDocument/formatting', { textDocument: { uri: MAIN_URI }, options })
}

function published(worker: InProcessTypeScriptWorker): readonly unknown[] {
  return worker.received.filter(
    (message) => (message as { method?: string }).method === 'textDocument/publishDiagnostics',
  )
}

function responsesTo(worker: InProcessTypeScriptWorker, id: number | string): readonly unknown[] {
  return worker.received.filter((message) => (message as { id?: unknown }).id === id)
}

function positionOf(text: string, marker: string, delta = 0): lsp.Position {
  const offset = text.indexOf(marker)
  if (offset === -1) throw new Error(`Fixture has no "${marker}"`)
  return offsetToLspPosition(text, offset + delta)
}

function rangeOf(text: string, marker: string, length: number): lsp.Range {
  return { start: positionOf(text, marker), end: positionOf(text, marker, length) }
}

function rangeOn(line: number, start: number, end: number): lsp.Range {
  return { start: { line, character: start }, end: { line, character: end } }
}

function applyEdits(text: string, edits: readonly lsp.TextEdit[]): string {
  const offsets = edits.map((edit) => ({
    start: offsetOf(text, edit.range.start),
    end: offsetOf(text, edit.range.end),
    newText: edit.newText,
  }))
  let result = text
  for (const edit of offsets.toSorted((left, right) => right.start - left.start)) {
    result = `${result.slice(0, edit.start)}${edit.newText}${result.slice(edit.end)}`
  }
  return result
}

function offsetOf(text: string, position: lsp.Position): number {
  const lines = text.split(/(?<=\n)/)
  let offset = 0
  for (let line = 0; line < position.line; line += 1) offset += lines[line]?.length ?? 0
  return offset + position.character
}
