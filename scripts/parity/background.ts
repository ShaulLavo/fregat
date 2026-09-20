import { deepStrictEqual, notStrictEqual, strictEqual } from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { BackgroundTaskRegistry } from '../../apps/server/src/provider/background-liveness'
import inventory from '../../plans/126-t3code-alignment/inventory.json'

const pin = '7445aa733ada33e45289e5aa5055f79142556513'
strictEqual(pin, inventory.upstream_commit)
const read = (path: string) =>
  execFileSync('git', ['-C', 'references/t3code', 'show', `${pin}:${path}`], { encoding: 'utf8' })
const sourcePath = 'apps/server/src/orchestration/ThreadBackgroundLiveness.ts'
const source = read(sourcePath)
const contracts = read('packages/contracts/src/providerRuntime.ts')
const constantsStart = contracts.indexOf('export const MONITOR_TASK_TYPES:')
const constantsEnd = contracts.indexOf('/**', constantsStart)
const terminalStart = source.indexOf('const TERMINAL_STATUSES:')
const terminalEnd = source.indexOf('export class ThreadBackgroundLivenessService', terminalStart)
const makeStart = source.indexOf('export function make():')
const makeEnd = source.indexOf('export const layer', makeStart)
strictEqual(
  [constantsStart, constantsEnd, terminalStart, terminalEnd, makeStart, makeEnd].every(
    (index) => index >= 0,
  ),
  true,
)
// Both classification sets are copied verbatim; the second declaration follows its one-line doc.
const inertStart = contracts.indexOf('export const INERT_TASK_TYPES:', constantsEnd)
const inertEnd = contracts.indexOf('\n', inertStart)
const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(
  [
    contracts.slice(constantsStart, constantsEnd),
    contracts.slice(inertStart, inertEnd),
    source.slice(terminalStart, terminalEnd),
    source.slice(makeStart, makeEnd),
  ].join('\n'),
)
const { make } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
)
const upstream = make()
const local = new BackgroundTaskRegistry()
let comparisons = 0
for (const taskType of [
  undefined,
  'agent',
  'local_agent',
  'local_workflow',
  'monitor',
  'monitor_mcp',
  'shell',
  'local_bash',
  'plan',
  'dream',
]) {
  for (const status of [
    undefined,
    'running',
    'waiting',
    'idle',
    'completed',
    'failed',
    'stopped',
    'cancelled',
    'interrupted',
  ]) {
    for (const kind of ['started', 'progress', 'updated', 'completed'] as const) {
      for (const agentId of [undefined, 'parent']) {
        const sessionId = comparisons % 3 === 0 ? 'other' : 'session'
        const taskId = `task-${comparisons % 7}`
        upstream.recordTaskLiveness({
          threadId: sessionId,
          taskId,
          taskType,
          status,
          kind,
          agentId,
        })
        local.record({ sessionId, taskId, taskType, status, kind, agentId })
        for (const id of ['session', 'other'])
          deepStrictEqual(local.get(id), upstream.getThreadBackgroundLiveness(id))
        comparisons++
      }
    }
  }
}
upstream.clearThreadLiveness('session')
local.clear('session')
strictEqual(local.get('session'), upstream.getThreadBackgroundLiveness('session'))
const controls = new BackgroundTaskRegistry()
controls.record({
  sessionId: 's',
  taskId: 'nested',
  taskType: 'local_agent',
  agentId: 'parent',
  kind: 'started',
})
notStrictEqual(controls.get('s'), null, 'Dropping nested agents must fail')
controls.record({
  sessionId: 's',
  taskId: 'nested',
  taskType: 'local_agent',
  kind: 'progress',
  status: 'idle',
})
controls.record({ sessionId: 's', taskId: 'nested', taskType: 'local_agent', kind: 'progress' })
notStrictEqual(controls.get('s'), 'working', 'Resurrecting idle tasks from metadata must fail')
controls.record({ sessionId: 's', taskId: 'watch', taskType: 'shell', kind: 'started' })
notStrictEqual(controls.get('s'), 'working', 'Treating watch loops as agents must fail')
console.log(
  JSON.stringify({
    pin,
    sourcePath,
    comparisons,
    negativeControls: 3,
    result: 'matched',
    scope: 'Pure liveness classification; provider and reaper delivery separately verified',
  }),
)
