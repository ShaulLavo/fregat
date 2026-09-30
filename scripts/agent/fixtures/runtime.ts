import type { FixtureRequest } from './protocol.ts'
import { appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

export function fixtureIO(url: string, log = 'native.jsonl') {
  const root = dirname(fileURLToPath(url))
  return {
    root,
    record(entry: unknown) {
      appendFileSync(join(root, log), `${JSON.stringify(entry)}\n`)
    },
    send: sendJSON,
  }
}

export function trackLifecycle(record: (entry: Record<string, unknown>) => void) {
  record({ event: 'spawn', pid: process.pid })
  process.on('exit', () => record({ event: 'exit', pid: process.pid }))
  process.on('SIGTERM', () => process.exit(0))
}

export function codexInitialization(root: string) {
  return {
    userAgent: 'Codex/0.154.0 verification',
    platformFamily: 'unix',
    platformOs: 'linux',
    codexHome: root,
  }
}

export function codexModels(displayName: string, description: string) {
  return {
    data: [
      {
        id: 'gpt-5.5',
        model: 'gpt-5.5',
        displayName,
        description,
        hidden: false,
        isDefault: true,
        defaultReasoningEffort: 'medium',
        supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Medium' }],
      },
    ],
    nextCursor: null,
  }
}

export function beginTurn(
  send: (message: unknown) => void,
  message: FixtureRequest,
  threadId: string,
  turnId: string,
) {
  const turn = { id: turnId, status: 'inProgress', items: [] }
  send({ id: message.id, result: { turn } })
  send({ method: 'turn/started', params: { threadId, turn } })
}

export function readRequests(handle: (message: FixtureRequest) => void) {
  createInterface({ input: process.stdin }).on('line', (line: string) => {
    if (line.trim()) handle(JSON.parse(line))
  })
}

function codexThreadStart<Thread>(thread: Thread) {
  return {
    thread,
    model: 'gpt-5.5',
    modelProvider: 'openai',
    cwd: process.cwd(),
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    sandbox: { type: 'dangerFullAccess' },
  }
}

function codexThreadResult<Thread>(method: string | undefined, thread: () => Thread) {
  switch (method) {
    case 'thread/start':
    case 'thread/resume':
      return codexThreadStart(thread())
    case 'thread/read':
      return { thread: thread() }
    case 'thread/list':
      return { data: [], nextCursor: null }
    case 'skills/list':
      return { data: [] }
    default:
      return undefined
  }
}

export function codexResponse<Thread>(
  method: string | undefined,
  root: string,
  thread: () => Thread,
  models: () => unknown,
) {
  switch (method) {
    case 'initialize':
      return codexInitialization(root)
    case 'account/read':
      return { account: { type: 'apiKey' }, requiresOpenaiAuth: false }
    case 'model/list':
      return models()
    default:
      return codexThreadResult(method, thread)
  }
}

export function sendJSON(message: unknown) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

export function marker(text: string, pattern: RegExp) {
  return pattern.exec(text)?.[1] ?? null
}
