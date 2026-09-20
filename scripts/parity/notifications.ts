import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import * as v from 'valibot'
import { sessionIdSchema, turnIdSchema } from '../../packages/contracts/src/index'
import {
  sessionNotificationTransition,
  type NotificationCursor,
  type NotificationSession,
} from '../../packages/client-core/src/chat/notifications'
import inventory from '../../plans/126-t3code-alignment/inventory.json'

const pin = '7445aa733ada33e45289e5aa5055f79142556513'
strictEqual(pin, inventory.upstream_commit)
const path = 'apps/web/src/components/ThreadNotificationCoordinator.tsx'
const source = execFileSync('git', ['-C', 'references/t3code', 'show', `${pin}:${path}`], {
  encoding: 'utf8',
})
const start = source.indexOf('      let status = resolveSidebarThreadStatus(thread);')
const end = source.indexOf('      const title =', start)
strictEqual(start >= 0 && end > start, true)
const body = source
  .slice(start, end)
  .replaceAll('continue;', 'return { cursor: next.get(thread.id), kind: null, status };')
const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(`
export function transition(thread, previousCursor, inputStatus) {
  const resolveSidebarThreadStatus = () => inputStatus;
  const previous = { current: new Map(previousCursor ? [[thread.id, previousCursor]] : []) };
  const next = new Map();
  ${body}
  return { cursor: next.get(thread.id), kind, status };
}`)
const { transition } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
)
const id = v.parse(sessionIdSchema, '00000000-0000-4000-8000-000000000001')
const turnId = v.parse(turnIdSchema, 'turn')
const priors: (NotificationCursor | undefined)[] = [
  undefined,
  { attention: null, completion: null },
  { attention: 'turn:input', completion: 1000 },
  { attention: 'turn:approval', completion: 2000 },
  { attention: 'turn:failed', completion: 3000 },
]
let comparisons = 0
for (const status of ['ready', 'input', 'approval', 'working', 'monitoring', 'failed'] as const) {
  for (const archivedAt of [null, '2026-01-01']) {
    for (const prior of priors) compareTurns(status, archivedAt, prior)
  }
}
function compareTurns(
  status: 'ready' | 'input' | 'approval' | 'working' | 'monitoring' | 'failed',
  archivedAt: string | null,
  prior: NotificationCursor | undefined,
) {
  for (const state of ['completed', 'error', 'running'] as const) {
    for (const completedAt of [
      null,
      'invalid',
      new Date(1000).toISOString(),
      new Date(2000).toISOString(),
      new Date(4000).toISOString(),
    ]) {
      const session: NotificationSession = {
        id,
        title: 'Fixture',
        archivedAt,
        pendingApprovalCount: Number(status === 'approval'),
        pendingUserInputCount: Number(status === 'input'),
        runtime: null,
        backgroundLiveness: null,
        latestTurn: { turnId, state, completedAt },
      }
      if (status === 'working' || status === 'monitoring') session.backgroundLiveness = status
      if (status === 'failed')
        session.runtime = {
          sessionId: id,
          status: 'error',
          providerName: null,
          providerBindingHandle: null,
          providerConversationMarker: null,
          providerResumeCursor: null,
          runtimeEpoch: 'test',
          runtimeMode: 'full-access',
          activeTurnId: null,
          lastError: 'failed',
          updatedAt: '2026-01-01T00:00:00Z',
        }
      deepStrictEqual(
        sessionNotificationTransition(session, prior),
        transition(session, prior, status),
      )
      comparisons++
    }
  }
}
console.log(JSON.stringify({ pin, source: path, comparisons }))
