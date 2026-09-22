import type { Page } from 'playwright'
import { strictEqual, ok } from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Scenario } from './index'
import { openFixtureWorkspace } from '../fixture-workspace'
import { focusEditor, openFileFromTree, selectors } from '../selectors'

type ProtocolMessage = {
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
    const fixture = await mkdtemp('/work/tmp/fregat-lsp-tabs-')
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
      await page.waitForFunction(
        () =>
          Array.from(CSS.highlights).some(
            ([name, highlight]) => name.endsWith('-lsp-plugin-error') && highlight.size > 0,
          ),
        undefined,
        { timeout: 30_000 },
      )
      await step('diagnostics-visible')
      const uri = `file://${fixture}/lsp-retained-error.ts`
      const opens = messages.filter(
        (message) => message.method === 'textDocument/didOpen' && message.uri === uri,
      ).length
      ok(opens > 0, 'the instrument observed the initial didOpen')
      await openFileFromTree(page, 'lsp-retained-other.ts')
      await step('other-tab')
      strictEqual(
        messages.filter(
          (message) => message.method === 'textDocument/didClose' && message.uri === uri,
        ).length,
        0,
      )
      await selectors.editorTab(page, path.join(fixture, 'lsp-retained-error.ts').slice(1)).click()
      await focusEditor(page)
      const painted = await page.evaluate(() =>
        Array.from(CSS.highlights).some(
          ([name, highlight]) => name.endsWith('-lsp-plugin-error') && highlight.size > 0,
        ),
      )
      strictEqual(painted, true, 'diagnostics are already painted on return')
      strictEqual(
        messages.filter(
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
        messages.some(
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
      await rm(fixture, { recursive: true, force: true })
    }
  },
}

function captureProtocol(page: Page): ProtocolMessage[] {
  const messages: ProtocolMessage[] = []
  captures.set(page, messages)
  page.on('websocket', (socket) => {
    if (!socket.url().includes('/lsp')) return
    socket.on('framesent', ({ payload }) => messages.push(protocolMessage('sent', payload)))
    socket.on('framereceived', ({ payload }) => messages.push(protocolMessage('received', payload)))
  })
  return messages
}

function protocolMessage(direction: string, payload: string | Buffer): ProtocolMessage {
  const message = protocolRecord(JSON.parse(payload.toString()))
  const params = protocolRecord(message.params)
  const textDocument = protocolRecord(params.textDocument)
  const result = protocolRecord(message.result)
  const uri = textDocument.uri ?? params.uri
  const diagnostics = params.diagnostics ?? result.items
  return {
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
