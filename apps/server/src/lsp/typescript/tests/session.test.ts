import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { TypeScriptLspSession } from '../session'

type JsonMessage = Record<string, unknown>

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('TypeScriptLspSession', () => {
  it.each(['normal.ts', '..foo.ts'])(
    'answers hover and publishes diagnostics for the root-level file %s',
    async (fileName) => {
      const text = 'export const value: string = 1\n'
      const root = await fixtureRoot({ [fileName]: text })
      const { messages, session } = sessionForRoot(root)
      onTestFinished(() => session.dispose())
      const uri = fileUri(path.join(root, fileName))

      initialize(session)
      openDocument(session, uri, text)
      const hover = await request(session, messages, 2, 'textDocument/hover', {
        textDocument: { uri },
        position: { line: 0, character: 15 },
      })

      expect.soft(hover).toMatchObject({
        result: {
          contents: {
            kind: 'markdown',
            value: expect.stringContaining('const value: string'),
          },
        },
      })
      await expect
        .poll(() =>
          messages.find((message) => message.method === 'textDocument/publishDiagnostics'),
        )
        .toMatchObject({
          params: {
            uri,
            version: 0,
            diagnostics: [
              expect.objectContaining({ code: 2322, source: 'typescript', severity: 1 }),
            ],
          },
        })
    },
  )

  it('publishes diagnostics from dirty open-document text instead of disk', async () => {
    const root = await fixtureRoot({
      'src/index.ts': "export const value: string = 'ok'\n",
    })
    const { messages, session } = sessionForRoot(root)
    const uri = fileUri(path.join(root, 'src/index.ts'))

    initialize(session)
    notify(session, 'textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: 'typescript',
        version: 0,
        text: 'export const value: string = 1\n',
      },
    })

    const diagnostics = await waitForMessage(messages, 'textDocument/publishDiagnostics')

    expect(diagnostics.params).toMatchObject({
      uri,
      version: 0,
      diagnostics: [
        {
          code: 2322,
          source: 'typescript',
          severity: 1,
        },
      ],
    })
  })

  it('answers common TypeScript language requests', async () => {
    const root = await fixtureRoot({
      'src/other.ts': 'export function answer(input: string) { return input.length }\n',
      'src/index.ts': [
        "import { answer } from './other'",
        "const value = answer('hello')",
        '',
      ].join('\n'),
    })
    const { messages, session } = sessionForRoot(root)
    const uri = fileUri(path.join(root, 'src/index.ts'))
    const text = await Bun.file(path.join(root, 'src/index.ts')).text()

    initialize(session)
    openDocument(session, uri, text)

    const hover = await request(session, messages, 2, 'textDocument/hover', {
      textDocument: { uri },
      position: { line: 1, character: 15 },
    })
    const definition = await request(session, messages, 3, 'textDocument/definition', {
      textDocument: { uri },
      position: { line: 1, character: 15 },
    })
    const completion = await request(session, messages, 4, 'textDocument/completion', {
      textDocument: { uri },
      position: { line: 1, character: 13 },
    })
    const signature = await request(session, messages, 5, 'textDocument/signatureHelp', {
      textDocument: { uri },
      position: { line: 1, character: 21 },
    })
    const references = await request(session, messages, 6, 'textDocument/references', {
      textDocument: { uri },
      position: { line: 1, character: 15 },
      context: { includeDeclaration: true },
    })
    const symbols = await request(session, messages, 7, 'textDocument/documentSymbol', {
      textDocument: { uri },
    })
    const rename = await request(session, messages, 8, 'textDocument/rename', {
      textDocument: { uri },
      position: { line: 1, character: 6 },
      newName: 'nextValue',
    })
    const codeActions = await request(session, messages, 9, 'textDocument/codeAction', {
      textDocument: { uri },
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 5 },
      },
      context: { diagnostics: [] },
    })

    expect(JSON.stringify(hover.result)).toContain('answer')
    expect(JSON.stringify(definition.result)).toContain('other.ts')
    expect(JSON.stringify(completion.result)).toContain('answer')
    expect(JSON.stringify(signature.result)).toContain('input: string')
    expect(JSON.stringify(references.result)).toContain('index.ts')
    expect(JSON.stringify(symbols.result)).toContain('value')
    expect(rename.result).toEqual({
      documentChanges: [
        {
          edits: [
            {
              newText: 'nextValue',
              range: {
                start: { line: 1, character: 6 },
                end: { line: 1, character: 11 },
              },
            },
          ],
          textDocument: { uri: 'file:///src/index.ts', version: 0 },
        },
      ],
    })
    expect(codeActions.result).toEqual([])
  })

  it('maps workspace-relative document URIs to files inside the requested root', async () => {
    const workspaceRoot = await fixtureRoot({
      'project/src/other.ts': 'export const answer = 42\n',
      'project/src/index.ts': "import { answer } from './other'\nconsole.log(answer)\n",
    })
    const projectRoot = path.join(workspaceRoot, 'project')
    const { messages, session } = sessionForRoot(projectRoot, workspaceRoot)
    const uri = 'file:///project/src/index.ts'
    const text = await Bun.file(path.join(projectRoot, 'src/index.ts')).text()

    initialize(session)
    openDocument(session, uri, text)
    const definition = await request(session, messages, 2, 'textDocument/definition', {
      textDocument: { uri },
      position: { line: 1, character: 12 },
    })

    expect(definition.result).toMatchObject([
      {
        uri: 'file:///project/src/other.ts',
        range: {
          start: { line: 0, character: 13 },
          end: { line: 0, character: 19 },
        },
      },
    ])
  })

  it('uses a referenced tsconfig that contains the open document', async () => {
    const root = await fixtureRoot({
      'tsconfig.json': JSON.stringify({
        files: [],
        references: [{ path: './tsconfig.app.json' }],
        compilerOptions: {
          baseUrl: '.',
          paths: { '@/*': ['./src/*'] },
        },
      }),
      'tsconfig.app.json': JSON.stringify({
        compilerOptions: {
          target: 'ES2023',
          module: 'ESNext',
          moduleResolution: 'bundler',
          jsx: 'react-jsx',
          noEmit: true,
          baseUrl: '.',
          paths: { '@/*': ['./src/*'] },
        },
        include: ['src'],
      }),
      'src/components/app-header.tsx': "export const appHeader = 'header'\n",
      'src/index.ts':
        "import { appHeader } from '@/components/app-header'\nconsole.log(appHeader)\n",
    })
    const { messages, session } = sessionForRoot(root)
    const uri = fileUri(path.join(root, 'src/index.ts'))
    const text = await Bun.file(path.join(root, 'src/index.ts')).text()

    initialize(session)
    openDocument(session, uri, text)
    const diagnostics = await waitForMessage(messages, 'textDocument/publishDiagnostics')

    expect(diagnostics.params).toMatchObject({
      uri,
      diagnostics: [],
    })
  })

  it('ignores file URIs outside the configured root', async () => {
    const root = await fixtureRoot({
      'src/index.ts': 'const value = 1\n',
    })
    const outside = await fixtureRoot({
      'outside.ts': 'const secret = 1\n',
    })
    const { messages, session } = sessionForRoot(root)

    initialize(session)
    const hover = await request(session, messages, 2, 'textDocument/hover', {
      textDocument: { uri: fileUri(path.join(outside, 'outside.ts')) },
      position: { line: 0, character: 6 },
    })

    expect(hover.result).toBeNull()
  })

  it('applies incremental changes and publishes the current document version', async () => {
    const root = await fixtureRoot({
      'src/index.ts': "export const value: string = 'ok'\n",
    })
    const { messages, session } = sessionForRoot(root)
    const uri = fileUri(path.join(root, 'src/index.ts'))

    initialize(session)
    openDocument(session, uri, "export const value: string = 'ok'\n")
    notify(session, 'textDocument/didChange', {
      textDocument: { uri, version: 1 },
      contentChanges: [
        {
          range: {
            start: { line: 0, character: 29 },
            end: { line: 0, character: 33 },
          },
          text: '1',
        },
      ],
    })

    const diagnostics = await waitForMessage(messages, 'textDocument/publishDiagnostics')

    expect(diagnostics.params).toMatchObject({
      uri,
      version: 1,
      diagnostics: [expect.objectContaining({ code: 2322 })],
    })
  })
})

function sessionForRoot(root: string, workspaceRoot = root) {
  const messages: JsonMessage[] = []
  const session = new TypeScriptLspSession({
    root,
    workspaceRoot,
    diagnosticDelayMs: 0,
    send: (message) => messages.push(JSON.parse(message) as JsonMessage),
  })
  return { messages, session }
}

function initialize(session: TypeScriptLspSession): void {
  send(session, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      capabilities: {
        workspace: {
          workspaceEdit: {
            changeAnnotationSupport: { groupsOnLabel: true },
            documentChanges: true,
            failureHandling: 'undo',
            normalizesLineEndings: true,
            resourceOperations: ['create', 'rename', 'delete'],
          },
        },
      },
      initializationOptions: { diagnosticDelayMs: 0 },
    },
  })
}

function openDocument(session: TypeScriptLspSession, uri: string, text: string): void {
  notify(session, 'textDocument/didOpen', {
    textDocument: {
      uri,
      languageId: 'typescript',
      version: 0,
      text,
    },
  })
}

function notify(session: TypeScriptLspSession, method: string, params: unknown): void {
  send(session, { jsonrpc: '2.0', method, params })
}

function send(session: TypeScriptLspSession, message: JsonMessage): void {
  session.handleMessage(JSON.stringify(message))
}

async function request(
  session: TypeScriptLspSession,
  messages: readonly JsonMessage[],
  id: number,
  method: string,
  params: unknown,
) {
  send(session, { jsonrpc: '2.0', id, method, params })
  return waitForResponse(messages, id)
}

async function waitForResponse(messages: readonly JsonMessage[], id: number) {
  return waitFor(() => messages.find((message) => message.id === id))
}

async function waitForMessage(messages: readonly JsonMessage[], method: string) {
  return waitFor(() => messages.find((message) => message.method === method))
}

async function waitFor<T>(read: () => T | undefined): Promise<T> {
  for (let index = 0; index < 50; index += 1) {
    const value = read()
    if (value !== undefined) return value
    await Bun.sleep(10)
  }

  throw new Error('timed out waiting for LSP message')
}

async function fixtureRoot(files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-ts-lsp-'))
  roots.push(root)

  for (const [relativePath, text] of Object.entries(files)) {
    const fileName = path.join(root, relativePath)
    await mkdir(path.dirname(fileName), { recursive: true })
    await writeFile(fileName, text)
  }

  return root
}

function fileUri(fileName: string) {
  const normalized = fileName.split(path.sep).join('/')
  return `file://${normalized.split('/').map(encodePathPart).join('/')}`
}

function encodePathPart(part: string, index: number) {
  if (index === 0 && part === '') return ''
  return encodeURIComponent(part)
}
