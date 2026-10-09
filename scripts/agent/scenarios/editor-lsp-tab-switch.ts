import { scratchPath } from '../paths'
import type { Page } from 'playwright'
import { deepStrictEqual, strictEqual, ok } from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Scenario } from './index'
import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import {
  focusEditor,
  lspErrorPainted,
  openFileFromTree,
  selectors,
  waitForLspErrorPaint,
} from '../selectors'

type ProtocolMessage = {
  connection: number
  direction: string
  method?: string
  uri?: string
  id?: number
  diagnosticCount?: number
}
const captures = new WeakMap<Page, ProtocolMessage[]>()

export const editorLspTabSwitch: Scenario = {
  inspect: async (page) => captures.get(page),
  name: 'editor-lsp-tab-switch',
  description:
    'Switch away and back to a TypeScript error without closing its LSP document or waiting for new diagnostics.',
  async run(page, { step }) {
    const originalUrl = page.url()
    const fixture = await mkdtemp(scratchPath('fregat-lsp-tabs-'))
    const messages = captureProtocol(page)
    try {
      await writeFile(
        path.join(fixture, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }),
      )
      await writeFile(
        path.join(fixture, 'lsp-retained-error.ts'),
        'export const value: number = "wrong"\n',
      )
      await writeFile(path.join(fixture, 'lsp-retained-other.ts'), 'export const other = 1\n')
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, 'lsp-retained-error.ts')
      await selectors
        .editorTab(page, path.join(fixture, 'lsp-retained-error.ts').slice(1))
        .waitFor()
      await focusEditor(page)
      await waitForLspErrorPaint(page)
      await step('diagnostics-visible')
      const uri = `file://${fixture}/lsp-retained-error.ts`
      // Symbol queries use separate temporary documents; retention belongs to diagnostic lanes.
      const editorMessages = () => {
        const connections = new Set(
          messages
            .filter(
              (message) =>
                message.direction === 'sent' &&
                message.method === 'textDocument/diagnostic' &&
                message.uri === uri,
            )
            .map((message) => message.connection),
        )
        return messages.filter((message) => connections.has(message.connection))
      }
      const initialConnections = new Set(editorMessages().map((message) => message.connection))
      const opens = editorMessages().filter(
        (message) => message.method === 'textDocument/didOpen' && message.uri === uri,
      ).length
      ok(opens > 0, 'the instrument observed the initial didOpen')
      await openFileFromTree(page, 'lsp-retained-other.ts')
      await step('other-tab')
      strictEqual(
        editorMessages().filter(
          (message) => message.method === 'textDocument/didClose' && message.uri === uri,
        ).length,
        0,
      )
      await selectors.editorTab(page, path.join(fixture, 'lsp-retained-error.ts').slice(1)).click()
      await focusEditor(page)
      const painted = await lspErrorPainted(page)
      strictEqual(painted, true, 'diagnostics are already painted on return')
      deepStrictEqual(
        new Set(editorMessages().map((message) => message.connection)),
        initialConnections,
        'returning to the tab reuses its diagnostic connections',
      )
      strictEqual(
        editorMessages().filter(
          (message) => message.method === 'textDocument/didOpen' && message.uri === uri,
        ).length,
        opens,
      )
      await step('diagnostics-restored')
      await selectors
        .editorTab(page, path.join(fixture, 'lsp-retained-error.ts').slice(1))
        .click({ button: 'right' })
      await selectors.menuItem(page, 'Close').click()
      await selectors
        .editorTab(page, path.join(fixture, 'lsp-retained-error.ts').slice(1))
        .waitFor({ state: 'detached' })
      await step('tab-closed')
      ok(
        editorMessages().some(
          (message) => message.method === 'textDocument/didClose' && message.uri === uri,
        ),
        'closing the last tab releases the LSP document',
      )
      await step('document-closed')
    } catch (error) {
      await step('failure-before-cleanup')
      throw error
    } finally {
      await page.goto(originalUrl)
      await releaseFixture(fixture)
    }
  },
}

function captureProtocol(page: Page): ProtocolMessage[] {
  const messages: ProtocolMessage[] = []
  let nextConnection = 0
  captures.set(page, messages)
  page.on('websocket', (socket) => {
    if (!socket.url().includes('/lsp')) return
    const connection = nextConnection++
    socket.on('framesent', ({ payload }) =>
      messages.push(protocolMessage('sent', payload, connection)),
    )
    socket.on('framereceived', ({ payload }) =>
      messages.push(protocolMessage('received', payload, connection)),
    )
  })
  return messages
}

function protocolMessage(
  direction: string,
  payload: string | Buffer,
  connection: number,
): ProtocolMessage {
  const message = protocolRecord(JSON.parse(payload.toString()))
  const params = protocolRecord(message.params)
  const textDocument = protocolRecord(params.textDocument)
  const result = protocolRecord(message.result)
  const uri = textDocument.uri ?? params.uri
  const diagnostics = params.diagnostics ?? result.items
  return {
    connection,
    direction,
    method: typeof message.method === 'string' ? message.method : undefined,
    id: typeof message.id === 'number' ? message.id : undefined,
    uri: typeof uri === 'string' ? uri : undefined,
    diagnosticCount: Array.isArray(diagnostics) ? diagnostics.length : undefined,
  }
}

function protocolRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value))
    return value as Record<string, unknown>
  return {}
}
