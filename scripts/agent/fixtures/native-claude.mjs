#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

/**
 * A Claude Code stand-in that speaks the agent SDK's stream-json protocol on stdio, the way the
 * SDK drives the real CLI: `initialize`, prompts, control requests both ways and results. It keeps
 * real transcripts under CLAUDE_CONFIG_DIR, so the SDK's history reads, resume and fork work, and
 * it does what the CLI does around a tool call: runs the project's PreToolUse command hooks, asks
 * `can_use_tool` unless a settings rule allows the call, writes the rules an approval adds, starts
 * `.mcp.json` servers and background shells for real. A turn answers the way its prompt asks:
 * "reply with exactly X" answers X, and "end with X" first recites the transcript's earlier
 * prompts. Its Bash tool runs only `sleep <seconds>`, `ls [path]` and `touch <path>`, each path
 * relative and inside the checkout; project hooks and approved `.mcp.json` servers run their own
 * commands, as the CLI's do. It exits when stdin closes, taking its children with it, and records
 * each child's pid so the harness can reap them if it is killed first. No credentials, no tokens.
 */
const VERSION = '99.0.0'
const MODEL = 'claude-haiku-4-5'
const root = dirname(fileURLToPath(import.meta.url))
const configDir = process.env.CLAUDE_CONFIG_DIR ?? join(root, 'config')
const args = process.argv.slice(2)
const record = (entry) =>
  appendFileSync(join(root, 'native.jsonl'), `${JSON.stringify({ pid: process.pid, ...entry })}\n`)
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)

if (args[0] === '--version') {
  process.stdout.write(`${VERSION} (Claude Code)\n`)
  process.exit(0)
}
if (args[0] === 'auth' && args[1] === 'status') {
  process.stdout.write(
    `${JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' })}\n`,
  )
  process.exit(0)
}
if (args[0] === 'auth' || args[0] === 'mcp') process.exit(1)

// The SDK passes some flags as `--name value` and others as `--name=value`.
const flag = (name) => {
  const joined = args.find((arg) => arg.startsWith(`${name}=`))
  if (joined) return joined.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const cwd = process.cwd()
const model = flag('--model') ?? MODEL
const permissionMode = flag('--permission-mode') ?? 'default'
const agent = flag('--agent') ?? null
const flagSettings = flag('--settings') ? JSON.parse(flag('--settings')) : {}
const resumed = flag('--resume') ?? null
const sessionId =
  args.includes('--fork-session') || !resumed
    ? (flag('--session-id') ?? crypto.randomUUID())
    : resumed

const mcp = new Map()
const tasks = new Map()
record({ event: 'spawn', args: args.filter((arg) => !arg.startsWith('{')) })
process.on('exit', () => {
  for (const task of tasks.values()) task.child.kill()
  for (const server of mcp.values()) server.child?.kill()
  record({ event: 'exit' })
})
process.on('SIGTERM', () => process.exit(0))

const checkout = realpathSync(cwd)
/** The harness reaps a recorded child by pid only while it still runs in this checkout. */
function recordChild(kind, child) {
  if (child.pid) record({ event: 'child', kind, childPid: child.pid, cwd: checkout })
}

// ---- Transcript, in the CLI's own layout so the SDK's session reads find it.

const projectDir = (folder) =>
  join(configDir, 'projects', folder.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 200))
const transcriptFile = (id) => join(projectDir(cwd), `${id}.jsonl`)
function readTranscript(id) {
  if (!existsSync(transcriptFile(id))) return []
  return readFileSync(transcriptFile(id), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}
function appendTranscript(entry) {
  mkdirSync(projectDir(cwd), { recursive: true })
  appendFileSync(transcriptFile(sessionId), `${JSON.stringify(entry)}\n`)
}

/** A fork copies the source conversation up to `--resume-session-at` into this session's file. */
function forkTranscript() {
  if (!resumed || !args.includes('--fork-session')) return
  const until = flag('--resume-session-at')
  const source = readTranscript(resumed)
  const end = until ? source.findIndex((entry) => entry.uuid === until) : source.length - 1
  for (const entry of source.slice(0, end + 1)) appendTranscript({ ...entry, sessionId })
  record({ event: 'fork', from: resumed, until, kept: end + 1 })
}
forkTranscript()
let lastUuid = readTranscript(sessionId).at(-1)?.uuid ?? null

function transcriptEntry(type, uuid, message) {
  const entry = {
    parentUuid: lastUuid,
    isSidechain: false,
    userType: 'external',
    cwd,
    sessionId,
    version: VERSION,
    gitBranch: 'main',
    entrypoint: 'sdk-ts',
    type,
    message,
    uuid,
    timestamp: new Date().toISOString(),
  }
  lastUuid = uuid
  appendTranscript(entry)
}

const earlierPrompts = () =>
  readTranscript(sessionId)
    .filter((entry) => entry.type === 'user' && typeof entry.message.content === 'string')
    .map((entry) => entry.message.content)

// ---- Settings, from the sources the SDK names, in the CLI's precedence order.

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {})
const settingsFiles = {
  userSettings: join(configDir, 'settings.json'),
  projectSettings: join(cwd, '.claude', 'settings.json'),
  localSettings: join(cwd, '.claude', 'settings.local.json'),
}
const allSettings = () => Object.values(settingsFiles).map(readJson).concat([flagSettings])
const sessionRules = new Set()

function allowedByRule(rule) {
  if (sessionRules.has(rule)) return true
  return allSettings().some((settings) => settings.permissions?.allow?.includes(rule))
}

/** Writes the rules an approval adds, where the CLI keeps each destination. */
function applyPermissionUpdates(updates) {
  for (const update of updates ?? []) {
    if (update.type !== 'addRules' || update.behavior !== 'allow') continue
    const rules = update.rules.map((rule) =>
      rule.ruleContent ? `${rule.toolName}(${rule.ruleContent})` : rule.toolName,
    )
    record({ event: 'permission-update', destination: update.destination, rules })
    if (update.destination === 'session') {
      for (const rule of rules) sessionRules.add(rule)
      continue
    }
    const file = settingsFiles[update.destination]
    if (!file) continue
    const settings = readJson(file)
    const allow = new Set((settings.permissions?.allow ?? []).concat(rules))
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(
      file,
      `${JSON.stringify({ ...settings, permissions: { ...settings.permissions, allow: [...allow] } }, null, 2)}\n`,
    )
  }
}

function commandHooks(event, toolName) {
  return allSettings().flatMap((settings) =>
    (settings.hooks?.[event] ?? [])
      .filter((group) => !group.matcher || new RegExp(`^(${group.matcher})$`).test(toolName))
      .flatMap((group) => group.hooks.filter((hook) => hook.type === 'command')),
  )
}

// ---- Project agents, read the way the CLI discovers them.

function parseAgent(file) {
  const text = readFileSync(file, 'utf8')
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
  if (!match) return null
  const field = (name) => new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(match[1])?.[1]?.trim()
  const name = field('name')
  return name ? { name, description: field('description') ?? '', prompt: match[2] } : null
}
function projectAgents() {
  const folder = join(cwd, '.claude', 'agents')
  if (!existsSync(folder)) return []
  return readdirSync(folder)
    .filter((file) => file.endsWith('.md'))
    .map((file) => parseAgent(join(folder, file)))
    .filter(Boolean)
}

// ---- MCP servers from `.mcp.json`, each started and asked for its tools.

function projectMcpDefinitions() {
  // Probes pass --strict-mcp-config with no servers: nothing from the project loads.
  if (args.includes('--strict-mcp-config')) return []
  const settings = allSettings()
  const all = settings.some((entry) => entry.enableAllProjectMcpServers === true)
  const enabled = new Set(settings.flatMap((entry) => entry.enabledMcpjsonServers ?? []))
  const disabled = new Set(settings.flatMap((entry) => entry.disabledMcpjsonServers ?? []))
  const servers = readJson(join(cwd, '.mcp.json')).mcpServers ?? {}
  return Object.entries(servers).filter(
    ([name]) => (all || enabled.has(name)) && !disabled.has(name),
  )
}

/** Resolves once the server answered `initialize` and `tools/list`, or failed to. */
function connectMcp(name, config) {
  const server = { name, config, status: 'pending', tools: [], child: null, error: undefined }
  mcp.set(name, server)
  return new Promise((resolve) => {
    const settle = (status, error) => {
      if (server.status !== 'pending') return
      server.status = status
      server.error = error
      record({ event: 'mcp', name, status })
      resolve()
    }
    const child = spawn(config.command, config.args ?? [], {
      cwd,
      env: { ...process.env, ...config.env },
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    server.child = child
    recordChild('mcp', child)
    child.on('error', (error) => settle('failed', error.message))
    child.on('exit', () => settle('failed', 'Server exited during startup'))
    let buffer = ''
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      for (let index = buffer.indexOf('\n'); index >= 0; index = buffer.indexOf('\n')) {
        const reply = JSON.parse(buffer.slice(0, index))
        buffer = buffer.slice(index + 1)
        if (reply.id === 1) {
          server.serverInfo = reply.result?.serverInfo
          child.stdin.write(
            `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
          )
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`)
        }
        if (reply.id === 2) {
          server.tools = reply.result?.tools ?? []
          settle('connected')
        }
      }
    })
    child.stdin.on('error', () => {})
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'claude-code', version: VERSION },
        },
      })}\n`,
    )
    setTimeout(() => settle('failed', 'Connection timed out'), 10_000)
  })
}
const mcpReady = Promise.all(
  projectMcpDefinitions().map(([name, config]) => connectMcp(name, config)),
)
const mcpStatus = () =>
  Array.from(mcp.values(), (server) => ({
    name: server.name,
    status: server.status,
    ...(server.error ? { error: server.error } : {}),
    ...(server.serverInfo ? { serverInfo: server.serverInfo } : {}),
    config: { type: 'stdio', command: server.config.command, args: server.config.args ?? [] },
    scope: 'project',
    tools: server.tools.map((tool) => ({ name: tool.name, description: tool.description })),
  }))

// ---- Control requests the CLI sends the SDK, answered by `control_response`.

let nextRequest = 0
const pending = new Map()
function ask(request) {
  const id = `fixture-${++nextRequest}`
  send({ type: 'control_request', request_id: id, request })
  return new Promise((resolve) => pending.set(id, resolve))
}

let hookCallbacks = {}
/** Runs the SDK's own hooks for `event`, as the CLI does for callbacks registered at initialize. */
async function sdkHooks(event, input, toolName) {
  for (const group of hookCallbacks[event] ?? []) {
    if (toolName && group.matcher && !new RegExp(`^(${group.matcher})$`).test(toolName)) continue
    for (const id of group.hookCallbackIds ?? [])
      await ask({ subtype: 'hook_callback', callback_id: id, input })
  }
}

// ---- Turns.

const base = () => ({ session_id: sessionId, uuid: crypto.randomUUID() })
const usage = {
  input_tokens: 1200,
  output_tokens: 40,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}
let turns = 0
let interrupted = false
let jsonSchema = null

function assistant(content, uuid) {
  const message = {
    id: `msg_${crypto.randomUUID().replaceAll('-', '')}`,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: null,
    stop_sequence: null,
    usage,
  }
  send({ type: 'assistant', message, parent_tool_use_id: null, ...base(), uuid })
  return message
}
const toolResult = (toolUseId, content, isError) =>
  send({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }],
    },
    parent_tool_use_id: null,
    ...base(),
  })
const system = (subtype, fields) => send({ type: 'system', subtype, ...fields, ...base() })

function init() {
  system('init', {
    agents: projectAgents().map((entry) => entry.name),
    apiKeySource: 'none',
    claude_code_version: VERSION,
    cwd,
    tools: ['Bash', 'Read', 'Edit', 'Write'],
    mcp_servers: mcpStatus().map((server) => ({ name: server.name, status: server.status })),
    model,
    permissionMode,
    slash_commands: ['compact'],
    output_style: 'default',
    skills: [],
    plugins: [],
  })
}

function result(text, extra = {}) {
  send({
    type: 'result',
    subtype: 'success',
    duration_ms: 120,
    duration_api_ms: 100,
    is_error: false,
    num_turns: 1,
    result: text,
    stop_reason: 'end_turn',
    total_cost_usd: 0.0021,
    usage,
    modelUsage: {
      [model]: {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        webSearchRequests: 0,
        costUSD: 0.0021,
        contextWindow: 200_000,
        maxOutputTokens: 32_000,
      },
    },
    permission_denials: [],
    ...extra,
    ...base(),
  })
}

const marker = (text, pattern) => pattern.exec(text)?.[1] ?? null

function answerFor(prompt, earlier) {
  const recall = marker(prompt, /\bend with ([A-Z0-9_]+)/)
  const text = recall
    ? ['Earlier prompts in this conversation:']
        .concat(
          earlier.map((line) => `- ${line}`),
          [recall],
        )
        .join('\n')
    : (marker(prompt, /reply with exactly ([A-Za-z0-9_]+)/i) ??
      marker(prompt, /reply with ([A-Z0-9_]+)/) ??
      'FIXTURE_REPLY')
  // The agent's own instructions come first, as a model following its system prompt would.
  const running = agent ? projectAgents().find((entry) => entry.name === agent) : null
  const first = running
    ? marker(running.prompt, /Start every reply with the line ([A-Z0-9_]+)/)
    : null
  return first ? `${first}\n${text}` : text
}

/** A value of the shape the SDK's JSON schema asks for. */
function structured(schema) {
  if (schema?.type === 'boolean') return false
  if (schema?.type === 'number' || schema?.type === 'integer') return 0
  if (schema?.type === 'array') return []
  if (schema?.type !== 'object') return 'Fixture title'
  return Object.fromEntries(
    Object.entries(schema.properties ?? {}).map(([key, value]) => [key, structured(value)]),
  )
}

/** A relative path with no option, no `..`, and no symlink out of the checkout. */
function insideCheckout(path) {
  if (!path || path.startsWith('-') || isAbsolute(path)) return false
  if (path.split(/[\\/]/).includes('..')) return false
  let existing = resolve(cwd, path)
  while (!existsSync(existing)) existing = dirname(existing)
  const real = realpathSync(existing)
  return real === checkout || real.startsWith(`${checkout}${sep}`)
}

/** Why the Bash tool refuses `argv`, or null for the three shapes it runs. */
function refusal(argv) {
  const [name, ...rest] = argv
  if (name === 'sleep')
    return rest.length === 1 && /^\d+(\.\d+)?$/.test(rest[0])
      ? null
      : 'The fixture runs sleep with one number of seconds'
  if (name === 'touch')
    return rest.length === 1 && insideCheckout(rest[0])
      ? null
      : 'The fixture runs touch with one relative path inside the checkout'
  if (name === 'ls')
    return rest.length === 0 || (rest.length === 1 && insideCheckout(rest[0]))
      ? null
      : 'The fixture runs ls with at most one relative path inside the checkout'
  return 'The fixture Bash tool runs only sleep, ls and touch'
}

async function permitted(toolUseId, input) {
  if (permissionMode === 'bypassPermissions') return { allowed: true }
  const rule = `Bash(${input.command})`
  if (allowedByRule(rule)) {
    record({ event: 'allowed-by-rule', rule })
    return { allowed: true }
  }
  const reply = await ask({
    subtype: 'can_use_tool',
    tool_name: 'Bash',
    input,
    tool_use_id: toolUseId,
    permission_suggestions: [
      {
        type: 'addRules',
        rules: [{ toolName: 'Bash', ruleContent: input.command }],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ],
  })
  record({
    event: 'can-use-tool',
    behavior: reply.behavior,
    updates: reply.updatedPermissions?.length ?? 0,
  })
  if (reply.behavior !== 'allow') return { allowed: false, message: reply.message }
  applyPermissionUpdates(reply.updatedPermissions)
  return { allowed: true }
}

/** Returns the tool result the model sees. */
async function runBash(toolUseId, input) {
  const hookInput = {
    session_id: sessionId,
    transcript_path: transcriptFile(sessionId),
    cwd,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: input,
    tool_use_id: toolUseId,
  }
  for (const hook of commandHooks('PreToolUse', 'Bash')) {
    const hookId = crypto.randomUUID()
    const fields = { hook_id: hookId, hook_name: 'PreToolUse:Bash', hook_event: 'PreToolUse' }
    system('hook_started', fields)
    const run = spawnSync('sh', ['-c', hook.command], {
      cwd,
      input: JSON.stringify(hookInput),
      encoding: 'utf8',
    })
    const blocked = run.status === 2
    system('hook_response', {
      ...fields,
      output: `${run.stdout}${run.stderr}`,
      stdout: run.stdout,
      stderr: run.stderr,
      exit_code: run.status ?? 1,
      outcome: run.status === 0 ? 'success' : 'error',
    })
    record({ event: 'hook', command: hook.command, exit: run.status })
    if (blocked)
      return { content: `PreToolUse:Bash hook error: ${run.stderr.trim()}`, isError: true }
  }
  await sdkHooks('PreToolUse', hookInput, 'Bash')
  const permission = await permitted(toolUseId, input)
  if (!permission.allowed)
    return { content: permission.message ?? 'Permission denied', isError: true }
  const argv = input.command.split(/\s+/)
  const refused = refusal(argv)
  if (refused) return { content: refused, isError: true }
  if (input.run_in_background) return startTask(toolUseId, input, argv)
  const run = spawnSync(argv[0], argv.slice(1), { cwd, encoding: 'utf8' })
  record({ event: 'bash', command: input.command, exit: run.status })
  return { content: `${run.stdout}${run.stderr}`, isError: run.status !== 0 }
}

const roster = () =>
  system('background_tasks_changed', {
    tasks: Array.from(tasks.entries(), ([taskId, task]) => ({
      task_id: taskId,
      task_type: 'local_bash',
      description: task.description,
    })),
  })

function startTask(toolUseId, input, argv) {
  const taskId = `b${crypto.randomUUID().slice(0, 8)}`
  const child = spawn(argv[0], argv.slice(1), { cwd, stdio: 'ignore' })
  tasks.set(taskId, { child, description: input.command })
  record({ event: 'task-started', taskId, command: input.command })
  recordChild('task', child)
  system('task_started', {
    task_id: taskId,
    tool_use_id: toolUseId,
    description: input.command,
    task_type: 'local_bash',
    is_backgrounded: true,
  })
  roster()
  return { content: `Command running in background with ID: ${taskId}`, isError: false }
}

function stopTask(taskId) {
  const task = tasks.get(taskId)
  if (!task) return false
  task.child.kill()
  tasks.delete(taskId)
  record({ event: 'task-stopped', taskId })
  system('task_updated', { task_id: taskId, patch: { status: 'killed' } })
  roster()
  return true
}

function toolCalls(prompt) {
  if (!/\bBash tool\b/.test(prompt)) return []
  const background = /run_in_background set to true/.test(prompt)
  return Array.from(prompt.matchAll(/`([^`]+)`/g), ([, command]) => ({
    command,
    description: `Run ${command}`,
    ...(background ? { run_in_background: true } : {}),
  }))
}

async function compact(prompt, uuid) {
  init()
  transcriptEntry('user', uuid, { role: 'user', content: prompt })
  system('status', { status: 'compacting' })
  system('compact_boundary', { compact_metadata: { trigger: 'manual', pre_tokens: 1240 } })
  system('status', { status: null })
  record({ event: 'compact' })
  result('')
}

function startMonitorFixture() {
  const scenario = join(root, 'scenario')
  if (!existsSync(scenario) || readFileSync(scenario, 'utf8') !== 'background-monitor-liveness')
    return
  const agent = spawn('sleep', ['600'], { cwd, stdio: 'ignore' })
  const watch = spawn('sleep', ['700'], { cwd, stdio: 'ignore' })
  tasks.set('fixture-agent', { child: agent, description: 'Fixture agent' })
  tasks.set('fixture-watch', { child: watch, description: 'Fixture monitor' })
  recordChild('agent', agent)
  recordChild('monitor', watch)
  const agentTask = {
    task_id: 'fixture-agent',
    task_type: 'local_agent',
    description: 'Fixture agent',
  }
  const monitorTask = {
    task_id: 'fixture-watch',
    task_type: 'monitor',
    description: 'Fixture monitor',
  }
  system('background_tasks_changed', { tasks: [agentTask, monitorTask] })
  let lastStep = ''
  setInterval(() => {
    const marker = join(root, 'background-step')
    if (!existsSync(marker)) return
    const step = readFileSync(marker, 'utf8')
    if (step === lastStep) return
    lastStep = step
    if (step === 'monitor') {
      agent.kill()
      tasks.delete('fixture-agent')
      system('background_tasks_changed', { tasks: [monitorTask] })
    }
    if (step === 'ready') {
      watch.kill()
      tasks.delete('fixture-watch')
      system('background_tasks_changed', { tasks: [] })
    }
    if (step === 'late') {
      system('task_started', { ...monitorTask, description: 'Delayed bookend' })
      system('task_progress', {
        task_id: monitorTask.task_id,
        description: 'Delayed progress',
        usage: { duration_ms: 1, tool_uses: 0, total_tokens: 0 },
      })
    }
    record({ event: `background-${step}` })
  }, 50).unref()
}

async function turn(message) {
  const content = message.message.content
  const prompt =
    typeof content === 'string'
      ? content
      : content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('\n')
  const uuid = message.uuid ?? crypto.randomUUID()
  turns += 1
  interrupted = false
  record({ event: 'turn', prompt, uuid })
  await mcpReady
  if (prompt.trim() === '/compact') return compact(prompt, uuid)
  init()
  const earlier = earlierPrompts()
  transcriptEntry('user', uuid, { role: 'user', content: prompt })
  for (const input of toolCalls(prompt)) {
    const toolUseId = `toolu_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`
    const replyUuid = crypto.randomUUID()
    const reply = assistant([{ type: 'tool_use', id: toolUseId, name: 'Bash', input }], replyUuid)
    transcriptEntry('assistant', replyUuid, reply)
    const outcome = await runBash(toolUseId, input)
    if (interrupted) return
    toolResult(toolUseId, outcome.content, outcome.isError)
  }
  const text = answerFor(prompt, earlier)
  const replyUuid = crypto.randomUUID()
  const reply = assistant([{ type: 'text', text }], replyUuid)
  transcriptEntry('assistant', replyUuid, reply)
  await sdkHooks('Stop', {
    session_id: sessionId,
    transcript_path: transcriptFile(sessionId),
    cwd,
    hook_event_name: 'Stop',
    stop_hook_active: false,
  })
  startMonitorFixture()
  result(text, jsonSchema ? { structured_output: structured(jsonSchema) } : {})
}

const CONTEXT = {
  categories: [
    { name: 'System prompt', tokens: 3100, color: 'promptBorder', kind: 'used' },
    { name: 'System tools', tokens: 11800, color: 'inactive', kind: 'used' },
    {
      name: 'MCP tools',
      tokens: 900,
      color: 'cyan_FOR_SUBAGENTS_ONLY',
      kind: 'deferred',
      isDeferred: true,
    },
    { name: 'Messages', tokens: 1240, color: 'purple_FOR_SUBAGENTS_ONLY', kind: 'used' },
    { name: 'Autocompact buffer', tokens: 33000, color: 'inactive', kind: 'buffer' },
    { name: 'Free space', tokens: 149960, color: 'inactive', kind: 'free' },
  ],
  totalTokens: 16140,
  maxTokens: 200000,
  rawMaxTokens: 200000,
  percentage: 8,
  gridRows: [],
  model: MODEL,
  memoryFiles: [],
  mcpTools: [],
  agents: [],
}

function initializeResponse(request) {
  hookCallbacks = request.hooks ?? {}
  jsonSchema = request.jsonSchema ?? null
  return {
    commands: [
      {
        name: 'compact',
        description: 'Clear conversation history but keep a summary',
        argumentHint: '',
      },
    ],
    agents: projectAgents().map((entry) => ({ name: entry.name, description: entry.description })),
    output_style: 'default',
    available_output_styles: ['default'],
    models: [
      {
        value: 'default',
        resolvedModel: MODEL,
        displayName: 'Default',
        description: 'Fixture default',
      },
      { value: MODEL, displayName: 'Haiku', description: 'Fixture model' },
    ],
    account: { email: 'fixture@example.test', subscriptionType: 'max', tokenSource: 'claude.ai' },
  }
}

async function control(request) {
  switch (request.subtype) {
    case 'initialize':
      return initializeResponse(request)
    case 'interrupt':
      interrupted = true
      result('', {
        subtype: 'error_during_execution',
        is_error: true,
        terminal_reason: 'aborted_streaming',
      })
      return {}
    case 'mcp_status':
      await mcpReady
      return { mcpServers: mcpStatus() }
    case 'mcp_reconnect': {
      const server = mcp.get(request.serverName)
      if (!server) throw new Error(`No MCP server ${request.serverName}`)
      server.child?.kill()
      await connectMcp(server.name, server.config)
      return {}
    }
    case 'mcp_set_servers':
      return { added: Object.keys(request.servers ?? {}), removed: [], errors: {} }
    case 'get_context_usage':
      return CONTEXT
    case 'stop_task':
      if (!stopTask(request.task_id)) throw new Error(`No task ${request.task_id}`)
      return {}
    case 'get_usage':
      record({ event: 'usage-read' })
      // A fixture account has no plan windows to report.
      return {
        session: {
          total_cost_usd: 0,
          total_api_duration_ms: 0,
          total_duration_ms: 0,
          total_lines_added: 0,
          total_lines_removed: 0,
          model_usage: {},
        },
        subscription_type: 'max',
        rate_limits_available: false,
        rate_limits: null,
      }
    case 'background_tasks':
      return { backgrounded: true }
    case 'reload_skills':
      return { skills: [], commands: [], agents: [] }
    case 'set_model':
    case 'set_permission_mode':
    case 'set_max_thinking_tokens':
    case 'apply_flag_settings':
    case 'mcp_toggle':
      return {}
    default:
      throw new Error(`Unsupported fixture control request ${request.subtype}`)
  }
}

async function answerControl(message) {
  try {
    const response = await control(message.request)
    send({
      type: 'control_response',
      response: { subtype: 'success', request_id: message.request_id, response },
    })
  } catch (error) {
    send({
      type: 'control_response',
      response: { subtype: 'error', request_id: message.request_id, error: error.message },
    })
  }
}

let queue = Promise.resolve()
createInterface({ input: process.stdin })
  .on('line', (line) => {
    if (!line.trim()) return
    const message = JSON.parse(line)
    if (message.type === 'control_request') return void answerControl(message)
    if (message.type === 'control_response') {
      const resolve = pending.get(message.response.request_id)
      pending.delete(message.response.request_id)
      return resolve?.(message.response.response ?? {})
    }
    if (message.type === 'user') queue = queue.then(() => turn(message))
  })
  // No control response can arrive once stdin closes, so a turn waiting on one never ends.
  .on('close', () => process.exit(0))
