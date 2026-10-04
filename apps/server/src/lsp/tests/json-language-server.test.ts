import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { SETTINGS_JSON_SCHEMA } from '@workspace/contracts'
import { presentSetting } from '@workspace/contracts/settings/documentation'

import { encodeLspStdioMessage, LspStdioMessageReader } from '../stdio-rpc'

const USER_ID = 'settings-json:user'
const WORKSPACE_ID = 'settings-json:workspace'
const SETTINGS_IDS = [USER_ID, WORKSPACE_ID] as const
const clients: JsonLanguageServerClient[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('JSON language server against the generated settings schema', () => {
  it('serves both settings documents without associating ordinary JSON', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'platform-json-ls-'))
    roots.push(root)
    const client = new JsonLanguageServerClient(root)
    clients.push(client)
    await client.initialize()
    client.notify('json/schemaAssociations', [
      [
        {
          uri: 'platform://schemas/settings',
          fileMatch: SETTINGS_IDS,
          schema: SETTINGS_JSON_SCHEMA,
        },
      ],
    ])

    const userText = '{\n  "editor.fontSize": 13,\n  \n}'
    client.open(USER_ID, userText)
    const languageStatus = await client.request('json/languageStatus', USER_ID)
    expect(languageStatus.result).toMatchObject({
      schemas: ['platform://schemas/settings'],
    })
    const propertyCompletion = await client.request('textDocument/completion', {
      position: positionAt(userText, userText.lastIndexOf('\n}')),
      textDocument: { uri: USER_ID },
    })
    expect(completionLabels(propertyCompletion)).toContain('workbench.colorTheme')

    const hover = await client.request('textDocument/hover', {
      position: positionAt(userText, userText.indexOf('editor.fontSize') + 3),
      textDocument: { uri: USER_ID },
    })
    expect(hoverText(hover).replaceAll('\\', '')).toContain(
      presentSetting('editor.fontSize').description,
    )

    const workspaceText = '{\n  "workbench.colorTheme": ""\n}'
    client.open(WORKSPACE_ID, workspaceText)
    const valueCompletion = await client.request('textDocument/completion', {
      position: positionAt(workspaceText, workspaceText.indexOf('""') + 1),
      textDocument: { uri: WORKSPACE_ID },
    })
    expect(completionLabels(valueCompletion).map(unquote)).toEqual(
      expect.arrayContaining(['dark', 'light', 'system']),
    )

    const ordinaryUri = `file://${path.join(root, 'ordinary.json')}`
    const ordinaryText = '{\n  \n}'
    client.open(ordinaryUri, ordinaryText)
    const ordinaryCompletion = await client.request('textDocument/completion', {
      position: positionAt(ordinaryText, ordinaryText.lastIndexOf('\n}')),
      textDocument: { uri: ordinaryUri },
    })
    expect(completionLabels(ordinaryCompletion)).not.toContain('workbench.colorTheme')
  })
})

type JsonRpcId = number | string

type JsonRpcMessage = {
  readonly error?: unknown
  readonly id?: JsonRpcId
  readonly method?: string
  readonly params?: unknown
  readonly result?: unknown
}

type PendingRequest = {
  resolve(message: JsonRpcMessage): void
  reject(reason: unknown): void
}

class JsonLanguageServerClient {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly exit: Promise<void>
  private readonly pending = new Map<number, PendingRequest>()
  private readonly root: string
  private nextId = 1
  private initialized = false
  private closed = false

  constructor(root: string) {
    this.root = root
    this.child = spawn(jsonLanguageServerBinary(), ['--stdio'], { cwd: root })
    const reader = new LspStdioMessageReader((message) => this.receive(message))
    this.child.stdout.on('data', (chunk) => reader.push(chunk))
    this.child.once('error', (error) => this.rejectPending(error))
    this.exit = new Promise((resolve) => {
      this.child.once('exit', () => {
        this.closed = true
        this.rejectPending('JSON language server exited')
        resolve()
      })
    })
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      capabilities: {
        textDocument: {
          completion: { completionItem: { snippetSupport: true } },
          hover: { contentFormat: ['markdown', 'plaintext'] },
        },
        workspace: { configuration: true },
      },
      initializationOptions: { provideFormatter: false },
      processId: process.pid,
      rootUri: `file://${this.root}`,
      workspaceFolders: [{ name: path.basename(this.root), uri: `file://${this.root}` }],
    })
    this.notify('initialized', {})
    this.initialized = true
  }

  open(uri: string, text: string): void {
    this.notify('textDocument/didOpen', {
      textDocument: { languageId: 'json', text, uri, version: 1 },
    })
  }

  request(method: string, params: unknown): Promise<JsonRpcMessage> {
    const id = this.nextId
    this.nextId += 1

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.send({ id, jsonrpc: '2.0', method, params })
    })
  }

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params })
  }

  async dispose(): Promise<void> {
    if (this.closed) return
    if (!this.initialized) {
      this.child.kill()
      await this.exit
      return
    }

    try {
      await this.request('shutdown', null)
    } catch {
      this.child.kill()
      await this.exit
      return
    }

    this.notify('exit', null)
    await this.exit
  }

  private receive(encoded: string): void {
    const message = JSON.parse(encoded) as JsonRpcMessage
    if (message.method && message.id !== undefined) {
      this.respondToServer(message)
      return
    }
    if (typeof message.id !== 'number') return

    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    if (message.error !== undefined) {
      pending.reject(message.error)
      return
    }

    pending.resolve(message)
  }

  private respondToServer(message: JsonRpcMessage): void {
    this.send({ id: message.id, jsonrpc: '2.0', result: serverRequestResult(message) })
  }

  private rejectPending(reason: unknown): void {
    for (const pending of this.pending.values()) pending.reject(reason)
    this.pending.clear()
  }

  private send(message: object): void {
    this.child.stdin.write(encodeLspStdioMessage(JSON.stringify(message)))
  }
}

function serverRequestResult(message: JsonRpcMessage): unknown {
  if (message.method === 'workspace/configuration') return configurationResults(message.params)
  if (message.method === 'workspace/workspaceFolders') return []

  return null
}

function configurationResults(params: unknown): readonly null[] {
  if (!params || typeof params !== 'object') return []
  if (!('items' in params) || !Array.isArray(params.items)) return []

  return params.items.map(() => null)
}

function completionLabels(message: JsonRpcMessage): readonly string[] {
  const result = message.result
  const items = Array.isArray(result) ? result : completionListItems(result)

  return items.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    if (!('label' in item) || typeof item.label !== 'string') return []
    return [item.label]
  })
}

function completionListItems(result: unknown): readonly unknown[] {
  if (!result || typeof result !== 'object') return []
  if (!('items' in result) || !Array.isArray(result.items)) return []

  return result.items
}

function hoverText(message: JsonRpcMessage): string {
  const result = message.result
  if (!result || typeof result !== 'object') return ''
  if (!('contents' in result)) return ''
  const contents = result.contents
  if (Array.isArray(contents)) return contents.map(hoverContentText).join('\n')

  return hoverContentText(contents)
}

function hoverContentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!content || typeof content !== 'object') return ''
  if (!('value' in content) || typeof content.value !== 'string') return ''

  return content.value
}

function positionAt(text: string, offset: number) {
  const before = text.slice(0, offset)
  const lines = before.split('\n')
  return { line: lines.length - 1, character: lines.at(-1)?.length ?? 0 }
}

function unquote(value: string): string {
  return value.replace(/^"|"$/gu, '')
}

function jsonLanguageServerBinary(): string {
  return path.resolve(import.meta.dirname, '../../../node_modules/.bin/vscode-json-language-server')
}
