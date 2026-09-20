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

function handle(message) {
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
