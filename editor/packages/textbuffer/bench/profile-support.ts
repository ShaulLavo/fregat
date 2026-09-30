import type { Profiler, HeapProfiler, Runtime } from 'node:inspector'
import type { PerformanceEntry } from 'node:perf_hooks'
type Frame = Pick<Runtime.CallFrame, 'functionName' | 'url' | 'lineNumber' | 'columnNumber'>
type CpuProfile = {
  nodes: { id: number; callFrame: Frame; children?: number[] }[]
  samples?: number[]
}
type HeapNode = { callFrame: Frame; selfSize: number; children?: HeapNode[] }
type HeapProfile = { head: HeapNode }
import type { Buffer, Counters, CounterValues, TreeNode } from './contracts.ts'
import { fileURLToPath } from 'node:url'
import { packageRoot, upstreamRoot } from './support.ts'

// The counters the report tables and the committed budgets track: structural
// work per operation, not every instrumented function.
const STRUCTURAL_COUNTER =
  /cloneNode\.calls|createNode\.calls|node\.own\.calls|join\.join\.calls|join\.rotate(?:Left|Right)\.calls|reverseIndex\.(?:appendSlot|copyBranch|privateTail|splitNode)\.calls|copiedArraySlots|indexInputCodeUnits|typedArrayCapacityBytes|typedArrayCopiedBytes|normalizePieceOrders\.calls|tryCoalesceInsert\.calls|extendTailChunk\.calls|splitsSurrogatePair\.calls|readPieceTableTextRange\.calls|collectTextInRange\.calls|mixString\.calls|snapBatchEditRanges\.calls|codeUnitAt\.calls|lineStartOffset\.calls|findLineRange\.calls|PieceBufferChunkView\.(?:fork|fill|open)\.calls|getPositionAt\.calls|getOffsetAt\.calls|getLineContent\.calls|cachedLineHits|TreeNode\.constructor\.calls|leftRotate\.calls|rightRotate\.calls|createLineStarts.*loopIterations|countLineBreaks\.loopIterations|extendBufferLineIndex\.loopIterations/

export function isStructuralCounter(name: string) {
  return STRUCTURAL_COUNTER.test(name)
}

export function createCounters(): Counters {
  let active = false
  let values: CounterValues = {}
  return {
    start() {
      values = {}
      active = true
    },
    stop() {
      active = false
      return Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)))
    },
    add(name: string, amount = 1) {
      if (active) values[name] = (values[name] ?? 0) + amount
    },
  }
}

export function frameName(frame: Frame) {
  let file = frame.url ?? ''
  if (file.startsWith('file:')) file = fileURLToPath(file)
  file = file.replace(upstreamRoot, 'vscode').replace(packageRoot, 'textbuffer')
  return `${file}:${frame.lineNumber + 1}:${frame.functionName || '(anonymous)'}`
}

function inWorkload(frame: Frame) {
  return frame.functionName === 'runOperations' && frame.url.endsWith('/bench/worker.ts')
}

// Exclusive buckets: recurse through a reverse-index function only counts once.
function category(frames: Frame[]) {
  const urls = frames.map((frame) => frame.url).join(' ')
  if (/\/reverseIndex\.js/.test(urls)) return 'reverse index'
  if (/\/buffers\.js/.test(urls)) return 'buffer store / line index'
  if (/\/lineEndings\.js/.test(urls)) return 'line-ending detection / normalization'
  if (/\/edits\.js/.test(urls) && !/\/tree\.js|\/positions\.js|\/reads\.js/.test(urls))
    return 'edit preparation / boundary policy'
  if (/\/positions\.js/.test(urls)) return 'position lookup'
  if (/\/tree\.js/.test(urls)) return 'piece tree'
  if (/\/rbTreeBase\.js/.test(urls)) return 'red-black tree'
  if (/\/pieceTree(?:Base|Builder)\.js/.test(urls)) return 'VS Code buffer / line index'
  return 'adapter / harness / other'
}

function sorted(map: CounterValues) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }))
}

export function summarizeCpu(profiles: CpuProfile[]) {
  let samples = 0
  let ignoredSamples = 0
  const self: CounterValues = {}
  const inclusive: CounterValues = {}
  const categories: CounterValues = {}
  for (const profile of profiles) {
    const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
    const parents = new Map<number, number>()
    for (const node of profile.nodes)
      for (const child of node.children ?? []) parents.set(child, node.id)
    for (const id of profile.samples ?? []) {
      const frames = []
      let node = nodes.get(id)
      while (node) {
        frames.push(node.callFrame)
        node = nodes.get(parents.get(node.id) ?? -1)
      }
      const root = frames.findIndex(inWorkload)
      if (root < 0) {
        ignoredSamples += 1
        continue
      }
      const measured = frames.slice(0, root + 1)
      samples += 1
      const leaf = frameName(measured[0])
      self[leaf] = (self[leaf] ?? 0) + 1
      for (const name of new Set(measured.map(frameName)))
        inclusive[name] = (inclusive[name] ?? 0) + 1
      const group = category(measured)
      categories[group] = (categories[group] ?? 0) + 1
    }
  }
  return {
    samples,
    ignoredSamples,
    self: sorted(self),
    inclusive: sorted(inclusive),
    categories: sorted(categories),
    warning:
      samples < 100
        ? 'Fewer than 100 in-workload samples: increase --repeats; do not rank small shares.'
        : null,
  }
}

export function summarizeHeap(profiles: HeapProfile[]) {
  const self: CounterValues = {}
  const inclusive: CounterValues = {}
  const categories: CounterValues = {}
  let sampledBytes = 0
  let ignoredBytes = 0
  for (const profile of profiles) {
    function visit(node: HeapNode, ancestors: Frame[]) {
      const frames = [node.callFrame].concat(ancestors)
      const root = frames.findIndex(inWorkload)
      if (root >= 0 && node.selfSize > 0) {
        const measured = frames.slice(0, root + 1)
        const name = frameName(measured[0])
        sampledBytes += node.selfSize
        self[name] = (self[name] ?? 0) + node.selfSize
        for (const frame of new Set(measured.map(frameName)))
          inclusive[frame] = (inclusive[frame] ?? 0) + node.selfSize
        const group = category(measured)
        categories[group] = (categories[group] ?? 0) + node.selfSize
      } else ignoredBytes += node.selfSize
      for (const child of node.children ?? []) visit(child, frames)
    }
    visit(profile.head, [])
  }
  return {
    sampledBytes,
    ignoredBytes,
    self: sorted(self),
    inclusive: sorted(inclusive),
    categories: sorted(categories),
  }
}

export function gcWithin(
  entries: Pick<PerformanceEntry, 'startTime' | 'duration'>[],
  started: number,
  ended: number,
) {
  return entries
    .filter((entry) => entry.startTime < ended && entry.startTime + entry.duration > started)
    .map((entry) => ({
      startTime: entry.startTime,
      durationMs:
        Math.min(ended, entry.startTime + entry.duration) - Math.max(started, entry.startTime),
      kind: gcDetail(entry).kind,
      flags: gcDetail(entry).flags,
    }))
}

export function structure(buffer: Buffer) {
  let pieces = 0
  let invisible = 0
  let maxDepth = 0
  const root = buffer.snapshot?.root ?? buffer.tree?.root
  const stack: [TreeNode, number][] = root ? [[root, 1]] : []
  while (stack.length) {
    const [node, depth] = stack.pop()!
    // The upstream sentinel has a null piece and cyclic children.
    if (!node?.piece) continue
    pieces += 1
    invisible += node.piece.visible === false ? 1 : 0
    maxDepth = Math.max(maxDepth, depth)
    if (node.left) stack.push([node.left, depth + 1])
    if (node.right) stack.push([node.right, depth + 1])
  }
  return { pieces, invisible, visible: pieces - invisible, maxDepth, ...buffer.stats() }
}

function gcDetail(entry: Pick<PerformanceEntry, 'startTime' | 'duration'>): {
  kind: number
  flags: number
} {
  if (!('detail' in entry) || typeof entry.detail !== 'object' || entry.detail === null)
    throw new TypeError('Expected GC detail')
  const detail = entry.detail
  if (
    !('kind' in detail) ||
    !('flags' in detail) ||
    typeof detail.kind !== 'number' ||
    typeof detail.flags !== 'number'
  )
    throw new TypeError('Expected GC metadata')
  return { kind: detail.kind, flags: detail.flags }
}
