import {
  frameKey,
  isApplicationFrame,
  traceNumber,
  traceRecord,
  type GeneratedFrame,
  type TraceEvent,
  type TraceThread,
} from './trace-types'

type ProfileNode = {
  readonly id: number
  readonly parent: number
  readonly frame: GeneratedFrame
}

type Observation = { readonly ts: number; readonly node: number }

export type SampleInterval = {
  readonly startUs: number
  readonly endUs: number
  readonly stack: readonly GeneratedFrame[]
}

export type SampledFrame = {
  readonly generated: GeneratedFrame
  readonly sampledMs: number
}

export function decodeMainThreadSamples(
  events: readonly TraceEvent[],
  main: TraceThread,
): readonly SampleInterval[] {
  const profiles = events.filter(
    (event) => event.name === 'Profile' && event.pid === main.pid && event.tid === main.tid,
  )
  return profiles
    .flatMap((profile) => decodeProfile(events, profile))
    .sort((a, b) => a.startUs - b.startUs)
}

function decodeProfile(events: readonly TraceEvent[], profile: TraceEvent): SampleInterval[] {
  // Chunks are emitted on a collector thread, not the thread named by Profile.
  const chunks = events
    .filter(
      (event) =>
        event.name === 'ProfileChunk' && event.pid === profile.pid && event.id === profile.id,
    )
    .sort((a, b) => a.ts - b.ts)
  const nodes = new Map<number, ProfileNode>()
  const observations: Observation[] = []
  let ts = traceNumber(traceRecord(profile.args.data).startTime, profile.ts)
  for (const chunk of chunks) {
    const data = traceRecord(chunk.args.data)
    const cpu = traceRecord(data.cpuProfile)
    collectNodes(nodes, cpu.nodes)
    ts = collectObservations(observations, cpu.samples, data.timeDeltas, ts)
  }
  // V8 emits signed deltas; clamping them would shift every subsequent sample.
  observations.sort((a, b) => a.ts - b.ts)
  const stacks = new Map<number, readonly GeneratedFrame[]>()
  return observations.flatMap((sample, index) => {
    const next = observations[index + 1]
    if (!next || next.ts <= sample.ts) return []
    const stack = stacks.get(sample.node) ?? stackForNode(nodes, sample.node)
    stacks.set(sample.node, stack)
    return [{ startUs: sample.ts, endUs: next.ts, stack }]
  })
}

function collectNodes(nodes: Map<number, ProfileNode>, raw: unknown) {
  if (!Array.isArray(raw)) return
  for (const entry of raw) {
    const node = traceRecord(entry)
    const callFrame = traceRecord(node.callFrame)
    const id = traceNumber(node.id)
    nodes.set(id, {
      id,
      parent: traceNumber(node.parent),
      frame: {
        scriptId: String(callFrame.scriptId ?? ''),
        functionName: String(callFrame.functionName || '(anonymous)'),
        url: String(callFrame.url ?? ''),
        line: traceNumber(callFrame.lineNumber, -1),
        column: traceNumber(callFrame.columnNumber, -1),
      },
    })
  }
}

function collectObservations(
  target: Observation[],
  samples: unknown,
  deltas: unknown,
  start: number,
) {
  if (!Array.isArray(samples) || !Array.isArray(deltas)) return start
  let ts = start
  for (let index = 0; index < Math.min(samples.length, deltas.length); index++) {
    ts += traceNumber(deltas[index])
    target.push({ ts, node: traceNumber(samples[index]) })
  }
  return ts
}

function stackForNode(nodes: ReadonlyMap<number, ProfileNode>, nodeId: number): GeneratedFrame[] {
  const stack: GeneratedFrame[] = []
  const seen = new Set<number>()
  let node = nodes.get(nodeId)
  while (node && !seen.has(node.id)) {
    seen.add(node.id)
    stack.push(node.frame)
    node = nodes.get(node.parent)
  }
  return stack
}

export function attributeSamples(
  task: Pick<TraceEvent, 'ts' | 'dur'>,
  samples: readonly SampleInterval[],
): readonly SampledFrame[] {
  const frames = new Map<string, { generated: GeneratedFrame; sampledMs: number }>()
  const end = task.ts + task.dur
  for (const sample of samples) {
    if (sample.startUs >= end) break
    const durationUs = Math.min(end, sample.endUs) - Math.max(task.ts, sample.startUs)
    if (durationUs <= 0) continue
    const frame = sample.stack.find(isApplicationFrame)
    if (!frame) continue
    const key = frameKey(frame)
    const attribution = frames.get(key) ?? { generated: frame, sampledMs: 0 }
    attribution.sampledMs += durationUs / 1000
    frames.set(key, attribution)
  }
  return [...frames.values()].sort((a, b) => b.sampledMs - a.sampledMs).slice(0, 3)
}
