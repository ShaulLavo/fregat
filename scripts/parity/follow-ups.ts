import { deepStrictEqual, notDeepStrictEqual, ok, strictEqual } from 'node:assert/strict'

import {
  followUpDue,
  latestCompletedToolActivityId,
  type FollowUpPhase,
} from '../../apps/web/src/features/chat/utils/follow-up-policy'
import { pin, readPinned } from './pinned'

const sourcePath = 'apps/web/src/queuedMessageStore.ts'
const source = readPinned(sourcePath)
const start = 'export function latestCompletedToolActivityId('
const end = 'export function useQueuedMessages('
strictEqual(source.split(start).length, 2, 'The extraction start must occur once.')
strictEqual(source.split(end).length, 2, 'The extraction end must occur once.')
const first = source.indexOf(start)
const last = source.indexOf(end)
ok(first >= 0 && last > first)
const extracted = source.slice(first, last)
ok(extracted.includes('export function isQueuedMessageDue('))
const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(extracted)
const upstream = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
)
if (process.env.PARITY_UPSTREAM_COMMIT) strictEqual(process.env.PARITY_UPSTREAM_COMMIT, pin)

type Activity = Parameters<typeof latestCompletedToolActivityId>[0][number]
type DueInput = {
  phase: FollowUpPhase
  held: boolean | undefined
  after: string | null
  latest: string | null
}
type Observation = string | boolean | null | (string | boolean | null)[]
type Comparison = { id: string; upstream: Observation; local: Observation }
const cases: Comparison[] = []
const negativeControls: {
  id: string
  caseId: string
  output: Observation
  result: 'rejected'
}[] = []

function pinnedLatest(activities: readonly Activity[]): string | null {
  const value: unknown = upstream.latestCompletedToolActivityId(activities)
  ok(value === null || typeof value === 'string')
  return value
}

function pinnedDue(input: DueInput): boolean {
  const value: unknown = upstream.isQueuedMessageDue({
    message: {
      queuedAfterToolActivityId: input.after,
      holdUntilUserAction: input.held,
    },
    phase: input.phase,
    latestToolActivityId: input.latest,
  })
  strictEqual(typeof value, 'boolean')
  ok(typeof value === 'boolean')
  return value
}

function localDue(input: DueInput) {
  return followUpDue({
    held: input.held ?? false,
    phase: input.phase,
    afterToolActivityId: input.after,
    latestToolActivityId: input.latest,
  })
}

function compare(id: string, expected: Observation, actual: Observation) {
  deepStrictEqual(actual, expected, id)
  cases.push({ id, upstream: expected, local: actual })
  return { id, upstream: expected, local: actual }
}

function control(id: string, comparison: Comparison, output: Observation) {
  notDeepStrictEqual(output, comparison.upstream, `Negative control survived: ${id}`)
  negativeControls.push({ id, caseId: comparison.id, output, result: 'rejected' })
}

function compareActivities(id: string, activities: readonly Activity[]) {
  return compare(id, pinnedLatest(activities), latestCompletedToolActivityId(activities))
}

function compareDue(id: string, input: DueInput) {
  return compare(id, pinnedDue(input), localDue(input))
}

const earlier = '2026-09-01T10:00:00.000Z'
const later = '2026-09-01T10:00:02.000Z'
const times = [earlier, '2026-09-01T10:00:01.000Z', later]
const sequences = [undefined, -2, -1, 0, 1, 12]
const kinds = ['tool.completed', 'tool.started', 'turn.completed', 'message']
const variants: Activity[] = kinds.flatMap((kind) =>
  sequences.flatMap((sequence) =>
    times.map((createdAt) => ({ id: 'variant', kind, sequence, createdAt })),
  ),
)
const singletons = variants.map((activity) => [activity])
const pairs = variants.flatMap((left) =>
  variants.map((right) => [
    { ...left, id: 'left' },
    { ...right, id: 'right' },
  ]),
)
compareActivities('latest-empty', [])
compare(
  'latest-singletons',
  singletons.map(pinnedLatest),
  singletons.map(latestCompletedToolActivityId),
)
compare('latest-pairs', pairs.map(pinnedLatest), pairs.map(latestCompletedToolActivityId))

function permutations(values: Activity[]): Activity[][] {
  if (values.length === 0) return [[]]
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidate) => candidate !== index)).map((rest) => [
      value,
      ...rest,
    ]),
  )
}

const shuffled = permutations([
  { id: 'completed-unsequenced', kind: 'tool.completed', createdAt: later },
  { id: 'completed-old', kind: 'tool.completed', sequence: 4, createdAt: later },
  { id: 'completed-new', kind: 'tool.completed', sequence: 5, createdAt: earlier },
  { id: 'started-newer', kind: 'tool.started', sequence: 6, createdAt: later },
])
compare(
  'latest-permutations',
  shuffled.map(pinnedLatest),
  shuffled.map(latestCompletedToolActivityId),
)

const phases: FollowUpPhase[] = ['connecting', 'running', 'ready', 'disconnected']
const holds = [undefined, false, true]
const tools = [null, 'tool-before', 'tool-after']
function dueInputsForPhase(phase: FollowUpPhase) {
  return holds.flatMap((held) => dueInputsForHold(phase, held))
}

function dueInputsForHold(phase: FollowUpPhase, held: boolean | undefined) {
  return tools.flatMap((after) => tools.map((latest) => ({ phase, held, after, latest })))
}
const dueInputs = phases.flatMap(dueInputsForPhase)
compare('due-phase-matrix', dueInputs.map(pinnedDue), dueInputs.map(localDue))

const sequenceWitness = [
  { id: 'high-sequence', kind: 'tool.completed', sequence: 5, createdAt: earlier },
  { id: 'low-sequence', kind: 'tool.completed', sequence: 2, createdAt: later },
]
const sequenceCase = compareActivities('latest-sequence-before-position-and-time', sequenceWitness)
control('array-position-instead-of-sequence', sequenceCase, sequenceWitness.at(-1)?.id ?? null)
control(
  'timestamp-instead-of-sequence',
  sequenceCase,
  sequenceWitness.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0]?.id ??
    null,
)
const tieWitness = [
  { id: 'older', kind: 'tool.completed', sequence: 5, createdAt: earlier },
  { id: 'newer', kind: 'tool.completed', sequence: 5, createdAt: later },
]
const tieCase = compareActivities('latest-time-breaks-sequence-tie', tieWitness)
control('ignore-timestamp-tiebreak', tieCase, tieWitness[0]?.id ?? null)

const connecting: DueInput = { phase: 'connecting', held: false, after: 'before', latest: 'after' }
control(
  'send-while-connecting',
  compareDue('due-connecting-is-blocked', connecting),
  connecting.latest !== connecting.after,
)
const held: DueInput = { phase: 'ready', held: true, after: null, latest: null }
control(
  'ignore-stop-or-failure-hold',
  compareDue('due-held-is-blocked', held),
  held.phase !== 'running',
)
const boundary: DueInput = { phase: 'running', held: false, after: 'before', latest: 'after' }
control(
  'wait-until-idle',
  compareDue('due-new-tool-boundary', boundary),
  boundary.phase !== 'running',
)
const same: DueInput = { phase: 'running', held: false, after: 'before', latest: 'before' }
control(
  'any-completed-tool-is-due',
  compareDue('due-same-tool-is-blocked', same),
  same.latest !== null,
)
const disconnected: DueInput = { phase: 'disconnected', held: false, after: null, latest: null }
control(
  'wait-for-ready-after-disconnect',
  compareDue('due-disconnected-is-ready', disconnected),
  disconnected.phase === 'ready',
)

const result = { upstreamCommit: pin, cases, negativeControls }
if (process.argv.includes('--summary')) {
  console.log(
    JSON.stringify({
      upstreamCommit: pin,
      sourcePath,
      cases: singletons.length + pairs.length + shuffled.length + dueInputs.length + 8,
      groups: cases.length,
      negativeControls: negativeControls.length,
      result: 'matched',
    }),
  )
} else {
  console.log(JSON.stringify(result))
}
