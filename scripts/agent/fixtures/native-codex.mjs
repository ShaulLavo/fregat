#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

const root = dirname(fileURLToPath(import.meta.url))
const record = (entry) => appendFileSync(join(root, 'native.jsonl'), `${JSON.stringify(entry)}\n`)
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
const scenario = readFileSync(join(root, 'scenario'), 'utf8')
let turnCount = 0
const threadId = `${basename(root)}-thread`
const turnId = `${basename(root)}-turn`
const thread = () => ({
  id: threadId,
  cliVersion: 'verification',
  createdAt: 0,
  updatedAt: 0,
  cwd: process.cwd(),
  ephemeral: false,
  modelProvider: 'openai',
  preview: 'MCP verification',
  source: 'appServer',
  status: { type: 'idle' },
  turns: [],
})
record({ event: 'spawn', pid: process.pid })
process.on('exit', () => record({ event: 'exit', pid: process.pid }))
process.on('SIGTERM', () => process.exit(0))

let backgroundStep = ''
if (scenario === 'background-liveness')
  setInterval(() => {
    let step
    try {
      step = readFileSync(join(root, 'background-step'), 'utf8')
    } catch {
      return
    }
    if (step === backgroundStep) return
    backgroundStep = step
    if (step === 'idle')
      send({
        method: 'thread/status/changed',
        params: { threadId: 'background-child', status: { type: 'idle' } },
      })
    if (step === 'metadata')
      send({
        method: 'thread/settings/updated',
        params: {
          threadId: 'background-child',
          threadSettings: { model: 'gpt-5.5', effort: 'medium' },
        },
      })
    record({ event: `background-${step}` })
  }, 50)

// Turn ids stay unique across a runtime restart, which spawns a fresh process.
let activeTurnId = null
function startOwnTurn(message) {
  activeTurnId = `${threadId}-turn-${process.pid}-${++turnCount}`
  const turn = { id: activeTurnId, status: 'inProgress', items: [] }
  send({ id: message.id, result: { turn } })
  send({ method: 'turn/started', params: { threadId, turn } })
  return activeTurnId
}
const agentDelta = (turn, itemId, delta) =>
  send({ method: 'item/agentMessage/delta', params: { threadId, turnId: turn, itemId, delta } })
const agentMessage = (turn, itemId, text) =>
  send({
    method: 'item/completed',
    params: { threadId, turnId: turn, item: { id: itemId, type: 'agentMessage', text } },
  })
const endTurn = (turn, status, error) =>
  send({
    method: 'turn/completed',
    params: { threadId, turn: { id: turn, status, items: [], ...(error ? { error } : {}) } },
  })
const promptText = (message) =>
  message.params.input
    .filter((entry) => entry.type === 'text')
    .map((entry) => entry.text)
    .join('\n')

/** Streams `chunks` as deltas `delayMs` apart, then settles the message and the turn. */
function streamAnswer(turn, itemId, chunks, delayMs) {
  const next = (index) => {
    if (index === chunks.length) {
      agentMessage(turn, itemId, chunks.join(''))
      endTurn(turn, 'completed')
      record({ event: 'stream-complete', itemId })
      return
    }
    agentDelta(turn, itemId, chunks[index])
    setTimeout(() => next(index + 1), delayMs)
  }
  next(0)
}

const LONG_ANSWER = Array.from(
  { length: 40 },
  (_, index) => `Paragraph ${index + 1} of a long answer that makes the transcript scroll.\n\n`,
)
const AMBIGUOUS_TAIL_CHUNKS = [
  'Intro line.\n\n',
  '#',
  '# ',
  'Heading two\n\n',
  'Use `',
  'code',
  '` inline.\n\n',
  '| Col A | Col B |\n',
  '| --',
  '- | --- |\n',
  '| 1 | 2 |\n\n',
  '* ',
  'item one\n\nDone.',
]
const CODE_COLOUR_CHUNKS = [
  'Here is the code:\n\n```ts\n',
  'export interface Point {\n',
  '  readonly x: number\n',
  '  readonly y: number\n}\n\n',
  'export function distance(a: Point, ',
  'b: Point): number {\n',
  '  const dx = a.x - b.x\n',
  '  const dy = a.y - b.y\n',
  '  return Math.sqrt(dx * dx + dy * dy)\n}\n\n',
  'const label = `distance: ${distance({ x: 0, y: 0 }, { x: 3, y: 4 })}`\n',
  'console.log(label)\n```\n\nDone.',
]

/**
 * `stopped-turn-reasons` keys each turn on its prompt: a partial answer that waits to be
 * stopped, a failure, a long answer, and a repeated prompt answered after a pause.
 */
// Counted from the log, not memory: a runtime restart spawns a fresh process.
function promptAttempts(text) {
  const lines = readFileSync(join(root, 'native.jsonl'), 'utf8').split('\n').filter(Boolean)
  return lines
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.event === 'turn/start' && entry.input === text).length
}
function stoppedTurnReasons(message) {
  const text = promptText(message)
  const seen = promptAttempts(text) + 1
  record({ event: 'turn/start', input: text, seen })
  const turn = startOwnTurn(message)
  const itemId = `${turn}-answer`
  if (text.startsWith('FILL')) {
    streamAnswer(turn, itemId, LONG_ANSWER, 0)
    return
  }
  if (seen > 1) {
    setTimeout(() => streamAnswer(turn, itemId, LONG_ANSWER, 50), 2_500)
    return
  }
  agentDelta(turn, itemId, `PARTIAL_ANSWER ${text.split(' ')[0]} The first half of an answer, `)
  if (text.startsWith('FAIL'))
    setTimeout(() => endTurn(turn, 'failed', { message: 'Verification provider failure.' }), 500)
}

function handle(message) {
  if (scenario === 'stopped-turn-reasons' && message.method === 'turn/start') {
    stoppedTurnReasons(message)
    return
  }
  if (scenario === 'stopped-turn-reasons' && message.method === 'turn/interrupt') {
    endTurn(activeTurnId, 'interrupted')
    send({ id: message.id, result: {} })
    return
  }
  if (scenario === 'chat-multiple-models' && message.method === 'turn/start') {
    record({ event: 'turn/start', model: message.params.model, input: promptText(message) })
    const turn = startOwnTurn(message)
    agentMessage(turn, `${turn}-answer`, `MULTIPLE_MODELS ${message.params.model}`)
    endTurn(turn, 'completed')
    return
  }
  if (scenario === 'chat-multiple-models' && message.method === 'model/list') {
    const entry = (id) => ({
      id,
      model: id,
      displayName: id,
      description: 'Isolated fan-out fixture',
      hidden: false,
      isDefault: id === 'gpt-5.5',
      defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Medium' }],
    })
    send({
      id: message.id,
      result: { data: [entry('gpt-5.5'), entry('gpt-5.5-mini')], nextCursor: null },
    })
    return
  }
  if (scenario === 'chat-artifact-template' && message.method === 'turn/start') {
    const turn = startOwnTurn(message)
    agentMessage(
      turn,
      `${turn}-answer`,
      [
        'I saved your document template.',
        '',
        '::artifact-template{artifact_kind="document" display_name="Weekly Report" skill_directory="/tmp/skills/artifact-template-weekly-report" skill_name="artifact-template-weekly-report"}',
        '',
        'Use it any time.',
      ].join('\n'),
    )
    endTurn(turn, 'completed')
    return
  }
  if (scenario === 'stream-ambiguous-tail' && message.method === 'turn/start') {
    const turn = startOwnTurn(message)
    streamAnswer(turn, `${turn}-answer`, AMBIGUOUS_TAIL_CHUNKS, 250)
    return
  }
  if (scenario === 'stream-code-colour' && message.method === 'turn/start') {
    const turn = startOwnTurn(message)
    streamAnswer(turn, `${turn}-answer`, CODE_COLOUR_CHUNKS, 250)
    return
  }
  if (scenario === 'response-delivery' && message.method === 'turn/start') {
    send({ id: message.id, result: { turn: { id: turnId, status: 'inProgress', items: [] } } })
    send({
      method: 'turn/started',
      params: { threadId, turn: { id: turnId, status: 'inProgress', items: [] } },
    })
    const first = 'REASONING_BEGIN ' + 'Full retained reasoning. '.repeat(20) + '\n\n'
    const second = 'REASONING_END ' + 'Final retained detail. '.repeat(20)
    for (const delta of [first, second])
      send({
        method: 'item/reasoning/summaryTextDelta',
        params: { threadId, turnId, itemId: 'reasoning-delivery', summaryIndex: 0, delta },
      })
    send({
      method: 'item/completed',
      params: {
        threadId,
        turnId,
        item: {
          id: 'reasoning-delivery',
          type: 'reasoning',
          summary: [first + second],
          content: [],
        },
      },
    })
    send({
      method: 'item/completed',
      params: {
        threadId,
        turnId,
        item: { id: 'delivery-answer', type: 'agentMessage', text: 'RESPONSE_DELIVERY_VERIFIED' },
      },
    })
    send({
      method: 'turn/completed',
      params: { threadId, turn: { id: turnId, status: 'completed', items: [] } },
    })
    return
  }
  if (
    ['file-attachments', 'chat-stash-context'].includes(scenario) &&
    message.method === 'turn/start'
  ) {
    const fileReference = message.params.input.find(
      (entry) => entry.type === 'text' && entry.text.startsWith('Attached file '),
    )
    const filePath = fileReference
      ? JSON.parse(fileReference.text.slice(fileReference.text.indexOf(': ') + 2))
      : null
    const contents = filePath ? readFileSync(filePath, 'utf8') : null
    record({ event: 'file-input', input: message.params.input, contents })
    send({ id: message.id, result: { turn: { id: turnId, status: 'inProgress', items: [] } } })
    send({
      method: 'turn/started',
      params: { threadId, turn: { id: turnId, status: 'inProgress', items: [] } },
    })
    send({
      method: 'item/completed',
      params: {
        threadId,
        turnId,
        item: {
          id: 'shared-file-answer',
          type: 'agentMessage',
          text:
            contents === 'General file verification.\n'
              ? 'FILE_ATTACHMENT_VERIFIED'
              : 'FILE_ATTACHMENT_FAILED',
        },
      },
    })
    send({
      method: 'turn/completed',
      params: { threadId, turn: { id: turnId, status: 'completed', items: [] } },
    })
    return
  }
  if (scenario === 'spinner-palette' && message.method === 'turn/start') {
    send({ id: message.id, result: { turn: { id: turnId, status: 'inProgress', items: [] } } })
    send({
      method: 'turn/started',
      params: { threadId, turn: { id: turnId, status: 'inProgress', items: [] } },
    })
    return
  }
  if (scenario === 'background-liveness' && message.method === 'turn/start') {
    send({
      id: message.id,
      result: { turn: { id: turnId, status: 'inProgress', items: [] } },
    })
    send({
      method: 'turn/started',
      params: {
        threadId,
        turn: { id: turnId, status: 'inProgress', items: [] },
      },
    })
    send({
      method: 'item/started',
      params: {
        threadId,
        turnId,
        item: {
          id: 'background-spawn',
          type: 'subAgentActivity',
          agentThreadId: 'background-child',
          agentPath: '/root/background',
          kind: 'started',
        },
      },
    })
    send({
      method: 'thread/started',
      params: {
        thread: {
          ...thread(),
          id: 'background-child',
          source: {
            subAgent: {
              thread_spawn: {
                parent_thread_id: threadId,
                agent_nickname: 'Background worker',
              },
            },
          },
        },
      },
    })
    send({
      method: 'turn/started',
      params: {
        threadId: 'background-child',
        turn: { id: 'background-child-turn', status: 'inProgress', items: [] },
      },
    })
    send({
      method: 'turn/completed',
      params: {
        threadId,
        turn: { id: turnId, status: 'completed', items: [] },
      },
    })
    record({ event: 'background-started' })
    return
  }
  if (message.id === 991 && !message.method) {
    record({
      event: 'approval-response',
      id: message.id,
      result: message.result,
    })
    send({
      method: 'item/completed',
      params: {
        threadId,
        turnId,
        item: {
          id: 'shared-mcp-answer',
          type: 'agentMessage',
          text: 'MCP_APPROVAL_VERIFIED',
        },
      },
    })
    send({
      method: 'turn/completed',
      params: {
        threadId,
        turn: { id: turnId, status: 'completed', items: [] },
      },
    })
    return
  }
  if (scenario === 'async-questions' && ['turn/start', 'turn/steer'].includes(message.method)) {
    const nativeTurnId = `${threadId}-async-turn-${message.method === 'turn/start' ? ++turnCount : turnCount}`
    record({ event: message.method, input: message.params.input })
    send({
      id: message.id,
      result:
        message.method === 'turn/start'
          ? { turn: { id: nativeTurnId, status: 'inProgress', items: [] } }
          : { turnId: nativeTurnId },
    })
    if (turnCount === 1 && message.method === 'turn/start') {
      send({
        method: 'turn/started',
        params: {
          threadId,
          turn: { id: nativeTurnId, status: 'inProgress', items: [] },
        },
      })
      for (const name of ['running', 'idle', 'dismiss']) {
        send({
          method: 'item/completed',
          params: {
            threadId,
            turnId: nativeTurnId,
            item: {
              id: `${name}-question`,
              type: 'agentMessage',
              delivery: 'async',
              text: '',
              questions: [
                {
                  title: `Verification ${name} question`,
                  options: ['Rust', 'Go'],
                },
              ],
            },
          },
        })
      }
      return
    }
    send({
      method: 'item/completed',
      params: {
        threadId,
        turnId: nativeTurnId,
        item: {
          id: `shared-async-answer-${turnCount}`,
          type: 'agentMessage',
          text: `ASYNC_${message.method === 'turn/steer' ? 'STEER' : 'START'}_VERIFIED`,
        },
      },
    })
    send({
      method: 'turn/completed',
      params: {
        threadId,
        turn: { id: nativeTurnId, status: 'completed', items: [] },
      },
    })
    return
  }
  if (message.id === undefined) return
  let result = {}
  switch (message.method) {
    case 'initialize':
      result = {
        userAgent: 'Codex/0.154.0 verification',
        platformFamily: 'unix',
        platformOs: 'linux',
        codexHome: root,
      }
      break
    case 'account/read':
      result = { account: { type: 'apiKey' }, requiresOpenaiAuth: false }
      break
    case 'model/list':
      result = {
        data: [
          {
            id: 'gpt-5.5',
            model: 'gpt-5.5',
            displayName: 'MCP verification',
            description: 'Isolated approval fixture',
            hidden: false,
            isDefault: true,
            defaultReasoningEffort: 'medium',
            supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Medium' }],
          },
        ],
        nextCursor: null,
      }
      break
    case 'thread/start':
    case 'thread/resume':
      result = {
        thread: thread(),
        model: 'gpt-5.5',
        modelProvider: 'openai',
        cwd: process.cwd(),
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        sandbox: { type: 'dangerFullAccess' },
      }
      break
    case 'thread/read':
      result = { thread: thread() }
      break
    case 'thread/list':
      result = { data: [], nextCursor: null }
      break
    case 'skills/list':
      result = { data: [] }
      break
    case 'turn/start':
      send({
        id: message.id,
        result: { turn: { id: turnId, status: 'inProgress', items: [] } },
      })
      send({
        method: 'turn/started',
        params: {
          threadId,
          turn: { id: turnId, status: 'inProgress', items: [] },
        },
      })
      send({
        id: 991,
        method: 'mcpServer/elicitation/request',
        params: {
          threadId,
          turnId,
          mode: 'form',
          message: 'Allow ChatGPT to use Verification App?',
          serverName: 'verification-only',
          requestedSchema: {
            properties: {
              approval: {
                enum: ['once', 'session', 'always'],
                enumNames: ['Allow once', 'Allow this session', 'Always allow Verification App'],
              },
            },
            required: ['approval'],
          },
        },
      })
      return
    case 'turn/interrupt':
      send({
        method: 'turn/completed',
        params: {
          threadId,
          turn: { id: turnId, status: 'interrupted', items: [] },
        },
      })
      break
    default:
      send({
        id: message.id,
        error: {
          code: -32601,
          message: `Unsupported verification method ${message.method}`,
        },
      })
      return
  }
  send({ id: message.id, result })
}
createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim()) handle(JSON.parse(line))
})
