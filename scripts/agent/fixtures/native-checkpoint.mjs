#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

/**
 * A Codex app-server stand-in whose conversation turns edit named files, so the
 * real server photographs a real checkpoint. No credentials, no tokens.
 *
 * `checkpoint-control.json` beside this file drives it:
 *   { cwd, turns: [[edit…], …], hold }
 * Turn N applies `turns[N-1]` (missing means no edits: a ready, empty turn).
 * Every edit is refused unless the thread's working directory is exactly `cwd`,
 * the disposable repository the scenario created and recorded.
 * While `hold` is true a finished edit waits before completing, so a scenario
 * can look at the pending state without sleeping.
 */
const root = dirname(fileURLToPath(import.meta.url))
const threadId = `checkpoint-thread-${process.pid}`
let turnNumber = 0
let conversationTurns = 0
let threadCwd = process.cwd()
const held = new Set()
const record = (entry) => appendFileSync(join(root, 'native.jsonl'), `${JSON.stringify(entry)}\n`)
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
const control = () => JSON.parse(readFileSync(join(root, 'checkpoint-control.json'), 'utf8'))
const thread = () => ({
  id: threadId,
  cliVersion: 'verification',
  createdAt: 0,
  updatedAt: 0,
  cwd: threadCwd,
  ephemeral: true,
  modelProvider: 'openai',
  preview: 'Checkpoint verification',
  source: 'appServer',
  status: { type: 'idle' },
  turns: [],
})
record({ event: 'spawn', pid: process.pid })
process.on('exit', () => record({ event: 'exit', pid: process.pid }))
process.on('SIGTERM', () => process.exit(0))

function finish(turnId, text) {
  send({
    method: 'item/completed',
    params: { threadId, turnId, item: { id: `${turnId}-answer`, type: 'agentMessage', text } },
  })
  send({
    method: 'turn/completed',
    params: { threadId, turn: { id: turnId, status: 'completed', items: [] } },
  })
  record({ event: 'turn-completed', pid: process.pid, turnId })
}

setInterval(() => {
  if (!held.size || control().hold) return
  for (const turnId of held) {
    held.delete(turnId)
    finish(turnId, 'CHECKPOINT_TURN_DONE')
  }
}, 50)

/** A relative path that stays inside the fixture; anything else aborts the turn. */
function inside(path) {
  const clean = normalize(path)
  if (isAbsolute(clean) || clean.startsWith('..')) throw new Error(`Refused path ${path}`)
  return join(threadCwd, clean)
}

function applyEdit(edit) {
  if (edit.op === 'write') {
    mkdirSync(dirname(inside(edit.path)), { recursive: true })
    writeFileSync(inside(edit.path), edit.text)
    return
  }
  if (edit.op === 'delete') {
    rmSync(inside(edit.path))
    return
  }
  if (edit.op === 'rename') {
    mkdirSync(dirname(inside(edit.to)), { recursive: true })
    renameSync(inside(edit.path), inside(edit.to))
    return
  }
  throw new Error(`Unknown edit ${edit.op}`)
}

/** Returns the refusal reason, or null once the turn's edits are on disk. */
function applyTurnEdits(settings) {
  if (threadCwd !== settings.cwd) return `cwd ${threadCwd} is not the fixture ${settings.cwd}`
  for (const edit of settings.turns[conversationTurns - 1] ?? []) applyEdit(edit)
  return null
}

function startTurn(message) {
  const turnId = `${threadId}-${++turnNumber}`
  const isTitle = JSON.stringify(message.params).includes('Conversation contents (reference data):')
  send({ id: message.id, result: { turn: { id: turnId, status: 'inProgress', items: [] } } })
  send({
    method: 'turn/started',
    params: { threadId, turn: { id: turnId, status: 'inProgress', items: [] } },
  })
  if (isTitle) {
    finish(turnId, JSON.stringify({ title: 'Checkpoint fixture', needsRefinement: false }))
    return
  }

  conversationTurns += 1
  const settings = control()
  const refused = applyTurnEdits(settings)
  record({ event: 'conversation-turn', pid: process.pid, turnId, refused })
  if (refused) {
    send({
      method: 'turn/completed',
      params: { threadId, turn: { id: turnId, status: 'failed', items: [] } },
    })
    return
  }
  if (settings.hold) {
    held.add(turnId)
    return
  }
  finish(turnId, 'CHECKPOINT_TURN_DONE')
}

function result(message) {
  switch (message.method) {
    case 'initialize':
      return {
        userAgent: 'Codex/0.154.0 verification',
        platformFamily: 'unix',
        platformOs: 'linux',
        codexHome: root,
      }
    case 'account/read':
      return { account: { type: 'apiKey' }, requiresOpenaiAuth: false }
    case 'model/list':
      return {
        data: [
          {
            id: 'gpt-5.5',
            model: 'gpt-5.5',
            displayName: 'Checkpoint fixture',
            description: 'Isolated checkpoint protocol fixture',
            hidden: false,
            isDefault: true,
            defaultReasoningEffort: 'medium',
            supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Medium' }],
          },
        ],
        nextCursor: null,
      }
    case 'thread/start':
    case 'thread/resume':
      threadCwd = message.params?.cwd ?? threadCwd
      return {
        thread: thread(),
        model: 'gpt-5.5',
        modelProvider: 'openai',
        cwd: threadCwd,
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        sandbox: { type: 'dangerFullAccess' },
      }
    case 'thread/read':
      return { thread: thread() }
    case 'thread/list':
      return { data: [], nextCursor: null }
    case 'skills/list':
      return { data: [] }
    case 'turn/interrupt':
      for (const turnId of held) {
        held.delete(turnId)
        send({
          method: 'turn/completed',
          params: { threadId, turn: { id: turnId, status: 'interrupted', items: [] } },
        })
      }
      return {}
    default:
      return undefined
  }
}

function handle(message) {
  if (message.id === undefined) return
  if (message.method === 'turn/start') return startTurn(message)

  const answer = result(message)
  if (answer !== undefined) return send({ id: message.id, result: answer })
  send({
    id: message.id,
    error: { code: -32601, message: `Unsupported checkpoint fixture method ${message.method}` },
  })
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim()) handle(JSON.parse(line))
})
