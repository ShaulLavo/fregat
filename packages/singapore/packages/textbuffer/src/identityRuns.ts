import type { PieceBufferId } from './pieceTableTypes'

/** One globally named UTF-16 code unit. Allocation belongs to the author, outside snapshots. */
export type CharId = { readonly bunch: string; readonly counter: number }
export type CharIdSpan = { readonly start: CharId; readonly count: number }

export type IdentityRun = {
  readonly bunch: string
  readonly counter: number
  readonly count: number
  readonly buffer: PieceBufferId
  readonly offset: number
}

type RunNode = {
  readonly run: IdentityRun
  readonly left: RunNode | null
  readonly right: RunNode | null
  readonly height: number
}

/** Two persistent indexes over the same runs; neither stores piece order or visibility. */
export type IdentityIndex = { readonly global: RunNode | null; readonly local: RunNode | null }

const byId = (left: IdentityRun, right: IdentityRun): number => {
  if (left.bunch !== right.bunch) return left.bunch < right.bunch ? -1 : 1
  return left.counter - right.counter
}
const byStorage = (left: IdentityRun, right: IdentityRun): number =>
  left.buffer - right.buffer || left.offset - right.offset

type Compare = typeof byId
const height = (node: RunNode | null): number => node?.height ?? 0
const node = (run: IdentityRun, left: RunNode | null, right: RunNode | null): RunNode => ({
  run,
  left,
  right,
  height: 1 + Math.max(height(left), height(right)),
})
const rotateLeft = (root: RunNode): RunNode => {
  const right = root.right!
  return node(right.run, node(root.run, root.left, right.left), right.right)
}
const rotateRight = (root: RunNode): RunNode => {
  const left = root.left!
  return node(left.run, left.left, node(root.run, left.right, root.right))
}
const balance = (root: RunNode): RunNode => {
  if (height(root.left) > height(root.right) + 1) {
    const left = root.left!
    const next = height(left.right) > height(left.left) ? rotateLeft(left) : left
    return rotateRight(node(root.run, next, root.right))
  }
  if (height(root.right) > height(root.left) + 1) {
    const right = root.right!
    const next = height(right.left) > height(right.right) ? rotateRight(right) : right
    return rotateLeft(node(root.run, root.left, next))
  }
  return root
}
const put = (root: RunNode | null, run: IdentityRun, compare: Compare): RunNode => {
  if (!root) return node(run, null, null)
  const direction = compare(run, root.run)
  if (direction === 0) return node(run, root.left, root.right)
  if (direction < 0) return balance(node(root.run, put(root.left, run, compare), root.right))
  return balance(node(root.run, root.left, put(root.right, run, compare)))
}
const floor = (root: RunNode | null, key: IdentityRun, compare: Compare): IdentityRun | null => {
  let candidate: IdentityRun | null = null
  while (root) {
    const direction = compare(key, root.run)
    if (direction === 0) return root.run
    if (direction < 0) {
      root = root.left
      continue
    }
    candidate = root.run
    root = root.right
  }
  return candidate
}
const ceiling = (root: RunNode | null, key: IdentityRun, compare: Compare): IdentityRun | null => {
  let candidate: IdentityRun | null = null
  while (root) {
    const direction = compare(key, root.run)
    if (direction === 0) return root.run
    if (direction > 0) {
      root = root.right
      continue
    }
    candidate = root.run
    root = root.left
  }
  return candidate
}
const idKey = (id: CharId): IdentityRun => ({
  ...id,
  count: 0,
  buffer: 0 as PieceBufferId,
  offset: 0,
})
const storageKey = (buffer: PieceBufferId, offset: number): IdentityRun => ({
  bunch: '',
  counter: 0,
  count: 0,
  buffer,
  offset,
})

export const validateCharId = (id: CharId): void => {
  if (
    typeof id.bunch !== 'string' ||
    id.bunch.length === 0 ||
    !Number.isSafeInteger(id.counter) ||
    id.counter < 0
  )
    throw new RangeError('invalid character identity')
}
export const validateCharIdSpan = (start: CharId, count: number): void => {
  validateCharId(start)
  if (!Number.isSafeInteger(count) || count <= 0 || !Number.isSafeInteger(start.counter + count))
    throw new RangeError('invalid character identity span')
}
export const identityRunAtId = (index: IdentityIndex, id: CharId): IdentityRun | null => {
  const run = floor(index.global, idKey(id), byId)
  if (!run || run.bunch !== id.bunch || id.counter >= run.counter + run.count) return null
  return run
}
export const identityRunAtStorage = (
  index: IdentityIndex,
  buffer: PieceBufferId,
  offset: number,
): IdentityRun | null => {
  const run = floor(index.local, storageKey(buffer, offset), byStorage)
  if (!run || run.buffer !== buffer || offset >= run.offset + run.count) return null
  return run
}
export const ensureUnusedCharIds = (index: IdentityIndex, start: CharId, count: number): void => {
  validateCharIdSpan(start, count)
  if (identityRunAtId(index, start)) throw new RangeError('character identities already exist')
  const next = ceiling(index.global, idKey(start), byId)
  if (next?.bunch === start.bunch && next.counter < start.counter + count)
    throw new RangeError('character identities already exist')
}

export const addIdentityRun = (index: IdentityIndex, run: IdentityRun): IdentityIndex => {
  const previous = identityRunAtStorage(index, run.buffer, run.offset - 1)
  const continues =
    previous &&
    previous.bunch === run.bunch &&
    previous.counter + previous.count === run.counter &&
    previous.offset + previous.count === run.offset
  const added = continues ? { ...previous, count: previous.count + run.count } : run
  return { global: put(index.global, added, byId), local: put(index.local, added, byStorage) }
}
export const createIdentityIndex = (start: CharId, count: number): IdentityIndex => {
  validateCharId(start)
  const empty: IdentityIndex = { global: null, local: null }
  if (count === 0) return empty
  validateCharIdSpan(start, count)
  return addIdentityRun(empty, { ...start, count, buffer: 0 as PieceBufferId, offset: 0 })
}

/** Keep one allocator per author session, even when restoring or replacing snapshots. */
export class CharIdAllocator {
  private runSeq = 0
  private readonly nextCounters = new Map<string, number>()

  constructor(readonly actor: string) {
    if (actor.length === 0) throw new RangeError('character identity actor must be nonempty')
  }

  /** Reserve identities from a restored author log before allocating more characters. */
  reserve(start: CharId, count: number): void {
    validateCharIdSpan(start, count)
    const prefix = `${this.actor}:`
    if (!start.bunch.startsWith(prefix)) return
    const suffix = start.bunch.slice(prefix.length)
    const sequence = Number(suffix)
    if (!Number.isSafeInteger(sequence) || sequence < 0 || String(sequence) !== suffix) return
    this.runSeq = Math.max(this.runSeq, sequence + 1)
    const next = Math.max(this.nextCounters.get(start.bunch) ?? 0, start.counter + count)
    this.nextCounters.set(start.bunch, next)
  }

  generateAfter(before: CharId | 'start', count = 1): CharId {
    if (!Number.isSafeInteger(count) || count <= 0) throw new RangeError('invalid identity count')
    if (before !== 'start') validateCharId(before)
    const next = before === 'start' ? undefined : this.nextCounters.get(before.bunch)
    if (before !== 'start' && next === before.counter + 1) {
      validateCharIdSpan({ bunch: before.bunch, counter: next }, count)
      this.nextCounters.set(before.bunch, next + count)
      return { bunch: before.bunch, counter: next }
    }
    if (!Number.isSafeInteger(this.runSeq + 1))
      throw new RangeError('identity run sequence exhausted')
    const bunch = `${this.actor}:${this.runSeq++}`
    this.nextCounters.set(bunch, count)
    return { bunch, counter: 0 }
  }
}
