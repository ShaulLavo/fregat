#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

/**
 * A Codex app-server stand-in that holds real conversations: each thread is a file under
 * `threads/`, so a resume, fork, rewind or history read in a fresh process sees the same turns.
 * A turn answers the way its prompt asks: "reply with exactly X" answers X, and "end with X"
 * first recites the thread's earlier prompts, which is how a fork shows what it remembers.
 * While `hold` exists beside this file a turn stays running. Commands run only as
 * `touch <path>`, the path relative and inside the checkout. It exits when stdin closes, held
 * turns and pending approvals included. No credentials, no tokens.
 */
const root = dirname(fileURLToPath(import.meta.url))
const codexHome = process.env.CODEX_HOME ?? root
const threadsDir = join(root, 'threads')
const rulesFile = join(codexHome, 'rules', 'default.rules')
const record = (entry) =>
  appendFileSync(join(root, 'native.jsonl'), `${JSON.stringify({ pid: process.pid, ...entry })}\n`)
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
mkdirSync(threadsDir, { recursive: true })
record({ event: 'spawn' })
process.on('exit', () => record({ event: 'exit' }))
process.on('SIGTERM', () => process.exit(0))

const threadFile = (id) => join(threadsDir, `${id}.json`)
const loadThread = (id) =>
  existsSync(threadFile(id)) ? JSON.parse(readFileSync(threadFile(id), 'utf8')) : null
const saveThread = (thread) => writeFileSync(threadFile(thread.id), JSON.stringify(thread))
const wire = (thread) => ({
  id: thread.id,
  sessionId: thread.id,
  projectId: null,
  cliVersion: 'verification',
  createdAt: 0,
  updatedAt: 0,
  cwd: thread.cwd,
  ephemeral: false,
  modelProvider: 'openai',
  preview: thread.turns[0]?.prompt ?? 'Conversation fixture',
  source: 'appServer',
  status: { type: 'idle' },
  turns: [],
})
const opened = (thread) => ({
  thread: wire(thread),
  model: 'gpt-5.5',
  modelProvider: 'openai',
  cwd: thread.cwd,
  approvalPolicy: thread.approvalPolicy,
  approvalsReviewer: 'user',
  sandbox: { type: 'dangerFullAccess' },
})

function newThread(params, turns = []) {
  const thread = {
    id: `conversation-${crypto.randomUUID()}`,
    cwd: params?.cwd ?? process.cwd(),
    approvalPolicy: params?.approvalPolicy ?? 'never',
    turns,
  }
  saveThread(thread)
  return thread
}

/** The one thread this process runs turns on; set by start, resume or fork. */
let current = null
let turnCount = 0
let serverRequestId = 900
const running = new Map()
const pendingApprovals = new Map()

function promptText(params) {
  return (params.input ?? [])
    .filter((entry) => entry.type === 'text')
    .map((entry) => entry.text)
    .join('\n')
}

const marker = (text, pattern) => pattern.exec(text)?.[1] ?? null

/** What the prompt asks for, from the thread's own history when it asks what came before. */
function answerFor(thread, prompt) {
  if (prompt.includes('Conversation contents (reference data):'))
    return JSON.stringify({ title: 'Conversation fixture', needsRefinement: false })
  const recall = marker(prompt, /\bend with ([A-Z0-9_]+)/)
  if (recall) {
    const earlier = thread.turns.filter((turn) => turn.kind === 'prompt').map((turn) => turn.prompt)
    return ['Earlier prompts in this conversation:']
      .concat(
        earlier.map((text) => `- ${text}`),
        [recall],
      )
      .join('\n')
  }
  return (
    marker(prompt, /reply with exactly ([A-Za-z0-9_]+)/i) ??
    marker(prompt, /reply with ([A-Z0-9_]+)/) ??
    'FIXTURE_REPLY'
  )
}

function startTurn(message) {
  const turnId = `${current.id}-turn-${process.pid}-${++turnCount}`
  const turn = { id: turnId, status: 'inProgress', items: [] }
  if (message) send({ id: message.id, result: { turn } })
  send({ method: 'turn/started', params: { threadId: current.id, turn } })
  return turnId
}

function item(phase, turnId, body) {
  send({ method: `item/${phase}`, params: { threadId: current.id, turnId, item: body } })
}

function endTurn(turnId, status) {
  running.delete(turnId)
  send({
    method: 'turn/completed',
    params: { threadId: current.id, turn: { id: turnId, status, items: [] } },
  })
  record({ event: 'turn-completed', turnId, status })
}

/** Keeps a turn running while `hold` exists, then runs `finish`; an interrupt ends it first. */
function whenReleased(turnId, finish) {
  running.set(turnId, finish)
  const poll = () => {
    if (!running.has(turnId)) return
    if (existsSync(join(root, 'hold'))) return void setTimeout(poll, 50)
    running.delete(turnId)
    finish()
  }
  poll()
}

function answer(turnId, prompt) {
  const thread = loadThread(current.id)
  const text = answerFor(thread, prompt)
  thread.turns.push({ id: turnId, kind: 'prompt', prompt, answer: text })
  saveThread(thread)
  item('completed', turnId, { id: `${turnId}-answer`, type: 'agentMessage', text })
  endTurn(turnId, 'completed')
}

function turnStart(message) {
  const prompt = promptText(message.params)
  if (message.params.approvalPolicy) current.approvalPolicy = message.params.approvalPolicy
  const turnId = startTurn(message)
  record({ event: 'turn/start', turnId, prompt, approvalPolicy: current.approvalPolicy })
  const command = marker(prompt, /run exactly `([^`]+)`/i)
  if (command) return runCommand(turnId, prompt, command.split(/\s+/))
  whenReleased(turnId, () => answer(turnId, prompt))
}

// A prefix rule in the form Codex writes to its user rules.
const ruleFor = (argv) =>
  `prefix_rule(pattern=[${argv.map((word) => JSON.stringify(word)).join(', ')}], decision="allow")\n`
const allowedByRule = (argv) =>
  existsSync(rulesFile) && readFileSync(rulesFile, 'utf8').includes(ruleFor(argv).trim())

function runCommand(turnId, prompt, argv) {
  if (current.approvalPolicy === 'never' || allowedByRule(argv)) {
    record({ event: 'command-without-approval', argv })
    return execute(turnId, prompt, argv)
  }
  const id = ++serverRequestId
  pendingApprovals.set(id, { turnId, prompt, argv })
  // Codex opens the command item before it asks, and completes it after the answer.
  item('started', turnId, commandItem(turnId, argv))
  send({
    id,
    method: 'item/commandExecution/requestApproval',
    params: {
      threadId: current.id,
      turnId,
      itemId: `${turnId}-command`,
      command: argv.join(' '),
      cwd: current.cwd,
      reason: null,
      proposedExecpolicyAmendment: argv,
      availableDecisions: [
        'accept',
        { acceptWithExecpolicyAmendment: { execpolicy_amendment: argv } },
        'cancel',
      ],
    },
  })
}

function approvalAnswered(message) {
  const pending = pendingApprovals.get(message.id)
  pendingApprovals.delete(message.id)
  const decision = message.result?.decision
  record({ event: 'approval-decision', decision })
  const amendment = decision?.acceptWithExecpolicyAmendment?.execpolicy_amendment
  if (amendment) {
    mkdirSync(dirname(rulesFile), { recursive: true })
    appendFileSync(rulesFile, ruleFor(amendment))
  }
  if (decision === 'accept' || amendment)
    return execute(pending.turnId, pending.prompt, pending.argv, { started: true })
  item('completed', pending.turnId, {
    ...commandItem(pending.turnId, pending.argv),
    status: 'declined',
  })
  endTurn(pending.turnId, 'interrupted')
}

const commandItem = (turnId, argv) => ({
  id: `${turnId}-command`,
  type: 'commandExecution',
  command: argv.join(' '),
  status: 'inProgress',
  aggregatedOutput: '',
})

/** A relative path with no option, no `..`, and no symlink out of the thread's checkout. */
function checkoutPath(path) {
  if (!path || path.startsWith('-') || isAbsolute(path)) return null
  if (path.split(/[\\/]/).includes('..')) return null
  const checkout = realpathSync(current.cwd)
  const target = resolve(checkout, path)
  let existing = target
  while (!existsSync(existing)) existing = dirname(existing)
  const real = realpathSync(existing)
  return real === checkout || real.startsWith(`${checkout}${sep}`) ? target : null
}

/** Runs only `touch <path>` inside the thread's checkout; anything else fails the command. */
function execute(turnId, prompt, argv, { started = false } = {}) {
  const target = argv[0] === 'touch' && argv.length === 2 ? checkoutPath(argv[1]) : null
  const command = commandItem(turnId, argv)
  if (!started) item('started', turnId, command)
  if (target) execFileSync('touch', [target])
  record({ event: 'command', argv, ran: Boolean(target) })
  item('completed', turnId, {
    ...command,
    status: target ? 'completed' : 'failed',
    exitCode: target ? 0 : 1,
    aggregatedOutput: target ? '' : 'Refused by the conversation fixture\n',
  })
  answer(turnId, prompt)
}

function compact(message) {
  send({ id: message.id, result: {} })
  const turnId = startTurn(null)
  const compaction = { id: `${turnId}-compaction`, type: 'contextCompaction' }
  item('started', turnId, compaction)
  const thread = loadThread(current.id)
  thread.turns.push({ id: turnId, kind: 'compact' })
  saveThread(thread)
  record({ event: 'compact', turnId })
  item('completed', turnId, compaction)
  endTurn(turnId, 'completed')
}

function projectHooks(cwd) {
  const file = join(cwd, '.codex', 'hooks.json')
  if (!existsSync(file)) return []
  const { hooks } = JSON.parse(readFileSync(file, 'utf8'))
  return Object.entries(hooks).flatMap(([event, groups]) =>
    groups.flatMap((group, groupIndex) =>
      group.hooks.map((hook, index) => ({
        key: `${event}:${groupIndex}:${index}`,
        eventName: `${event[0].toLowerCase()}${event.slice(1)}`,
        matcher: group.matcher ?? null,
        handlerType: 'command',
        command: hook.command,
        enabled: true,
        isManaged: false,
        source: 'project',
        sourcePath: file,
        displayOrder: groupIndex * 100 + index,
        timeoutSec: 600,
        trustStatus: 'trusted',
        currentHash: `${event}-${groupIndex}-${index}`,
      })),
    ),
  )
}

/** The servers `config.toml` in this Codex home names, each connected with no tools. */
function mcpServers() {
  const config = join(codexHome, 'config.toml')
  if (!existsSync(config)) return []
  const names = [...readFileSync(config, 'utf8').matchAll(/^\[mcp_servers\.([\w-]+)\]$/gm)]
  return names.map(([, name]) => ({
    name,
    authStatus: 'unsupported',
    runtimeStatus: 'connected',
    tools: {},
    resources: [],
    resourceTemplates: [],
  }))
}

function turnsList(message) {
  const thread = loadThread(message.params.threadId)
  const turns = (thread?.turns ?? []).map((turn) => ({ id: turn.id }))
  const data = message.params.sortDirection === 'asc' ? turns : turns.reverse()
  return { data: data.slice(0, message.params.limit ?? data.length), nextCursor: null }
}

function revert(message) {
  const thread = loadThread(message.params.threadId)
  const index = thread.turns.findIndex((turn) => turn.id === message.params.beforeTurnId)
  if (index >= 0) thread.turns.splice(index)
  saveThread(thread)
  record({ event: 'revert', beforeTurnId: message.params.beforeTurnId, left: thread.turns.length })
  return { thread: wire(thread) }
}

function fork(message) {
  const source = loadThread(message.params.threadId)
  const through = source.turns.findIndex((turn) => turn.id === message.params.lastTurnId)
  const turns = through >= 0 ? source.turns.slice(0, through + 1) : source.turns
  current = newThread({ ...message.params, cwd: message.params.cwd ?? source.cwd }, turns)
  record({
    event: 'fork',
    from: source.id,
    lastTurnId: message.params.lastTurnId,
    kept: turns.length,
  })
  return opened(current)
}

function result(message) {
  switch (message.method) {
    case 'initialize':
      return {
        userAgent: 'Codex/0.156.1 verification',
        platformFamily: 'unix',
        platformOs: 'linux',
        codexHome,
      }
    case 'account/read':
      return { account: { type: 'apiKey' }, requiresOpenaiAuth: false }
    case 'model/list':
      return {
        data: [
          {
            id: 'gpt-5.5',
            model: 'gpt-5.5',
            displayName: 'Conversation fixture',
            description: 'Isolated conversation fixture',
            hidden: false,
            isDefault: true,
            defaultReasoningEffort: 'medium',
            supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Medium' }],
          },
        ],
        nextCursor: null,
      }
    case 'thread/start':
      current = newThread(message.params)
      record({
        event: 'thread/start',
        threadId: current.id,
        approvalPolicy: current.approvalPolicy,
      })
      return opened(current)
    case 'thread/resume':
      current = loadThread(message.params.threadId)
      if (message.params.approvalPolicy) current.approvalPolicy = message.params.approvalPolicy
      saveThread(current)
      return opened(current)
    case 'thread/fork':
      return fork(message)
    case 'thread/read': {
      const thread = loadThread(message.params.threadId)
      return thread ? { thread: wire(thread) } : undefined
    }
    case 'thread/list':
      return { data: [], nextCursor: null }
    case 'thread/turns/list':
      return turnsList(message)
    case 'thread/revert':
      return revert(message)
    case 'skills/list':
      return { data: [] }
    case 'hooks/list':
      return {
        data: message.params.cwds.map((cwd) => ({
          cwd,
          errors: [],
          warnings: [],
          hooks: projectHooks(cwd),
        })),
      }
    case 'mcpServerStatus/list':
      return { data: mcpServers(), nextCursor: null }
    case 'config/read':
      return {
        config: {
          mcp_servers: Object.fromEntries(
            mcpServers().map(({ name }) => [name, { command: 'true' }]),
          ),
        },
        origins: {},
        layers: null,
      }
    case 'turn/interrupt':
      for (const turnId of running.keys()) endTurn(turnId, 'interrupted')
      return {}
    default:
      return undefined
  }
}

function handle(message) {
  if (!message.method && pendingApprovals.has(message.id)) return approvalAnswered(message)
  if (message.id === undefined) return
  if (message.method === 'turn/start') return turnStart(message)
  if (message.method === 'thread/compact/start') return compact(message)
  // Codex refuses to resume a thread it has no rollout for.
  if (message.method === 'thread/resume' && !loadThread(message.params.threadId))
    return send({
      id: message.id,
      error: { code: -32600, message: `No rollout found for thread ${message.params.threadId}` },
    })

  const reply = result(message)
  if (reply !== undefined) return send({ id: message.id, result: reply })
  send({
    id: message.id,
    error: { code: -32601, message: `Unsupported conversation fixture method ${message.method}` },
  })
}

createInterface({ input: process.stdin })
  .on('line', (line) => {
    if (line.trim()) handle(JSON.parse(line))
  })
  // Nothing can answer an approval or release a held turn once stdin closes.
  .on('close', () => process.exit(0))
