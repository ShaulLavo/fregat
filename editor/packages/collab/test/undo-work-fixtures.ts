import { UndoManager } from '../src/undo'
import type { Effect, Envelope } from '../src/types'

export function insertion(seq: number): Envelope {
  return {
    document: 'history-work',
    epoch: '1',
    id: { actor: 'a', seq },
    lamport: seq,
    deps: [],
    change: {
      kind: 'insert',
      start: { bunch: `a:${seq}`, counter: 0 },
      originLeft: 'start',
      originRight: 'end',
      text: 'x',
    },
  }
}

export function command(seq: number, effects: readonly Effect[]): Envelope {
  const id = { actor: 'a', seq }
  return {
    document: 'history-work',
    epoch: '1',
    id,
    lamport: seq,
    deps: [],
    change: { kind: 'setEffects', command: id, effects },
  }
}

export type Workload = 'undo' | 'redo' | 'acknowledge' | 'reject-group' | 'non-top-replay'

type Work = {
  searched: number
  shifted: number
  filtered: number
  copied: number
  mapped: number
  iterated: number
  indexed: number
  replayed: number
}

function measure(history: UndoManager, execute: () => void): Work {
  const work: Work = {
    searched: 0,
    shifted: 0,
    filtered: 0,
    copied: 0,
    mapped: 0,
    iterated: 0,
    indexed: 0,
    replayed: 0,
  }
  let active = false
  const restore: (() => void)[] = []
  const patch = (
    target: object,
    key: PropertyKey,
    count: (receiver: unknown, args: unknown[], result: unknown) => void,
  ) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, key)!
    Object.defineProperty(target, key, {
      ...descriptor,
      value: function (this: unknown, ...args: unknown[]) {
        const result = Reflect.apply(descriptor.value, this, args)
        if (active) count(this, args, result)
        return result
      },
    })
    restore.push(() => Object.defineProperty(target, key, descriptor))
  }
  const length = (receiver: unknown) => (receiver as unknown[]).length
  patch(Array.prototype, 'indexOf', (receiver, _args, result) => {
    work.searched += (result as number) < 0 ? length(receiver) : (result as number) + 1
  })
  // splice is observed after deletion, so its surviving suffix ends at the new length.
  patch(Array.prototype, 'splice', (receiver, args) => {
    work.shifted += Math.max(0, length(receiver) - (args[0] as number))
  })
  patch(Array.prototype, 'filter', (receiver) => {
    work.filtered += length(receiver)
  })
  patch(Array.prototype, 'map', (receiver) => {
    work.mapped += length(receiver)
  })
  patch(Array.prototype, 'slice', (_receiver, _args, result) => {
    work.copied += length(result)
  })
  const iterator = (target: object, key: PropertyKey) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, key)!
    Object.defineProperty(target, key, {
      ...descriptor,
      value: function (this: unknown, ...args: unknown[]) {
        const source = Reflect.apply(descriptor.value, this, args) as Iterator<unknown>
        return {
          next() {
            const result = source.next()
            if (active) work.iterated++
            return result
          },
          [Symbol.iterator]() {
            return this
          },
        }
      },
    })
    restore.push(() => Object.defineProperty(target, key, descriptor))
  }
  for (const key of ['get', 'set', 'has', 'delete'])
    patch(Map.prototype, key, () => {
      work.indexed++
    })
  for (const key of ['add', 'has', 'delete'])
    patch(Set.prototype, key, () => {
      work.indexed++
    })
  for (const key of ['keys', 'values', 'entries', Symbol.iterator]) iterator(Map.prototype, key)
  iterator(Array.prototype, Symbol.iterator)
  iterator(Set.prototype, Symbol.iterator)
  const rebuild = Reflect.get(history, 'rebuild')
  Reflect.set(history, 'rebuild', function (this: UndoManager, ...args: unknown[]) {
    if (active) work.replayed++
    return Reflect.apply(rebuild, this, args)
  })
  try {
    active = true
    execute()
  } finally {
    active = false
    Reflect.deleteProperty(history, 'rebuild')
    for (const reset of restore.reverse()) reset()
  }
  return work
}

export function historyWork(count: number, kind: Workload, Manager = UndoManager) {
  let seq = count
  const history = new Manager('a', (effects) => command(++seq, effects), { groupDelay: 0 })
  const edits = Array.from({ length: count }, (_, index) => insertion(index + 1))
  if (kind === 'reject-group') history.beginTransaction()
  for (const edit of edits) {
    history.record(edit, { boundary: kind !== 'reject-group' })
    if (kind !== 'acknowledge' && kind !== 'reject-group') history.remote(edit)
  }
  const commands: Envelope[] = []
  if (kind === 'redo' || kind === 'non-top-replay') {
    for (let index = 0; index < count; index++) {
      const envelope = history.undo()!
      commands.push(envelope)
      if (kind === 'redo') history.remote(envelope)
    }
  }
  const execute = () => {
    if (kind === 'acknowledge') {
      for (const edit of edits) history.remote(edit)
      return
    }
    if (kind === 'reject-group') {
      history.reject(edits.map((edit) => edit.id))
      return
    }
    if (kind === 'non-top-replay') {
      history.reject([commands[0]!.id])
      return
    }
    for (let index = 0; index < count; index++) history.remote(history[kind]()!)
  }
  const work = measure(history, execute)
  const state = history.state()
  return {
    work,
    total: Object.values(work).reduce((sum, value) => sum + value, 0),
    undo: state.undo.length,
    redo: state.redo.length,
  }
}
