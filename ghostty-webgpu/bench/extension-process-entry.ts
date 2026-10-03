import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Terminal } from '../src/dom/terminal.js'
import { ExtensionManager } from '../src/extensions/manager.js'
import type { Extension, TerminalInputEvent } from '../src/extensions/types.js'
import { TerminalSession } from '../src/term/session.js'

const [output, mode] = process.argv.slice(2)
assert(output)
assert(mode === 'counters' || mode === 'smoke' || mode === 'block')
const state = globalThis as typeof globalThis & { __x6Owned: Record<string, number> }
let setupCalls = 0
let contributionFactories = 0
let serial = 0
const errors: unknown[] = []
const identities = new WeakSet<Extension>()

function fresh(): Extension {
  const value: Extension = {
    name: `fresh-${serial++}`,
    setup: () => {
      setupCalls += 1
      contributionFactories += 1
      return {}
    },
  }
  assert(!identities.has(value))
  identities.add(value)
  return value
}

function resetCounts(): void {
  state.__x6Owned = Object.create(null) as Record<string, number>
  setupCalls = 0
  contributionFactories = 0
}

function capture(operation: string, inert: number) {
  return { operation, inert, counts: { ...state.__x6Owned }, setupCalls, contributionFactories }
}

class Cohort {
  private managerValue?: ExtensionManager
  readonly session: TerminalSession

  readonly terminal: Terminal

  private constructor(terminal: Terminal) {
    this.terminal = terminal
    // Current public activation is absent; this exposes native work as a named internal scope.
    this.session = (terminal as unknown as { readonly session: TerminalSession }).session
    assert(this.session instanceof TerminalSession)
  }

  static async create(values: readonly Extension[]): Promise<Cohort> {
    const terminal = await Terminal.create({
      runtime: {
        kind: 'owned',
        options: {
          wasm: pathToFileURL(join(output!, 'ghostty-vt.wasm')),
          bridge: pathToFileURL(join(output!, 'bridge.wasm')),
        },
      },
    })
    const cohort = new Cohort(terminal)
    if (values.length) cohort.manager.install(values)
    return cohort
  }

  get manager(): ExtensionManager {
    this.managerValue ??= new ExtensionManager({
      terminal: this.terminal,
      reservedOsc: new Set(),
      onError: (cause) => errors.push(cause),
    })
    return this.managerValue
  }

  warmZero(inert: number): void {
    if (inert !== 0) return
    this.manager.use(fresh()).dispose()
  }

  dispose(): void {
    this.managerValue?.dispose()
    this.terminal.dispose()
  }
}

const inputOperations = [
  'manager-key',
  'manager-text',
  'manager-paste',
  'manager-composition',
] as const
const key = { action: 'press' as const, code: 'KeyA', composing: false, text: 'a' }
const inputs: Readonly<Record<(typeof inputOperations)[number], TerminalInputEvent>> = {
  'manager-key': { type: 'key', input: key },
  'manager-text': { type: 'text', data: 't' },
  'manager-paste': { type: 'paste', data: 'p' },
  'manager-composition': { type: 'composition', text: '界' },
}
const nativeOperations = [
  'native-key',
  'native-text',
  'native-paste',
  'native-write',
  'native-geometry',
] as const
const rows: object[] = []

async function counterMatrix(): Promise<void> {
  const bootstrap = await Cohort.create([])
  bootstrap.dispose()
  for (const inert of [0, 1, 100, 1_000]) {
    const values = Array.from({ length: inert }, fresh)
    resetCounts()
    const cohort = await Cohort.create(values)
    rows.push({ ...capture('internal-host-manager-create', inert), freshIdentities: values.length })
    assert.equal(setupCalls, inert)
    cohort.dispose()
  }
  for (const inert of [0, 100, 1_000]) await counterCohort(inert)
}

async function counterCohort(inert: number): Promise<void> {
  const cohort = await Cohort.create(Array.from({ length: inert }, fresh))
  const target = fresh()
  resetCounts()
  const cold = cohort.manager.use(target)
  rows.push(capture('cold-internal-first-use', inert))
  cold.dispose()
  const freshTarget = fresh()
  resetCounts()
  const handle = cohort.manager.use(freshTarget)
  rows.push(capture('manager-use-fresh', inert))
  assert.equal(setupCalls, 1)
  resetCounts()
  handle.dispose()
  rows.push({ ...capture('manager-dispose', inert), otherInstalledInert: inert })
  assert.equal(setupCalls, 0)
  for (const operation of inputOperations) {
    resetCounts()
    assert.equal(cohort.manager.dispatchInput(inputs[operation]), false)
    rows.push(capture(operation, inert))
  }
  let payloadCalls = 0
  const payload = () => {
    payloadCalls += 1
    return { rows: cohort.session.renderState.readRows().map((row) => row.y) }
  }
  resetCounts()
  cohort.manager.emit('frame', payload)
  rows.push({ ...capture('manager-frame', inert), payloadCalls })
  assert.equal(payloadCalls, 0)
  for (const operation of nativeOperations) {
    resetCounts()
    const result = nativeOperation(cohort, operation)
    rows.push({ ...capture(operation, inert), result })
    if (operation === 'native-key')
      assert.equal(new TextDecoder().decode(result as Uint8Array), 'a')
    if (operation === 'native-text')
      assert.equal(new TextDecoder().decode(result as Uint8Array), 't')
    if (operation === 'native-paste')
      assert.equal(new TextDecoder().decode(result as Uint8Array), 'p')
    if (operation === 'native-geometry') assert.equal(result, 80)
    if (operation === 'native-write')
      assert(cohort.session.readLines(0, 1).some((line) => line.text.includes('process-write')))
  }
  let inputCalls = 0
  let frameCalls = 0
  let cleanupCalls = 0
  const positive = cohort.manager.use({
    name: 'positive',
    setup: (scope) => {
      scope.own(() => {
        cleanupCalls += 1
      })
      return {
        input: () => {
          inputCalls += 1
          return 'pass'
        },
        events: {
          frame: () => {
            frameCalls += 1
          },
        },
      }
    },
  })
  resetCounts()
  for (const operation of inputOperations) cohort.manager.dispatchInput(inputs[operation])
  cohort.manager.emit('frame', payload)
  rows.push({ ...capture('positive-dispatch', inert), inputCalls, frameCalls, payloadCalls })
  assert.equal(inputCalls, inputOperations.length)
  assert.equal(frameCalls, 1)
  assert.equal(payloadCalls, 1)
  resetCounts()
  positive.dispose()
  rows.push({ ...capture('positive-dispose', inert), cleanupCalls })
  assert.equal(cleanupCalls, 1)
  cohort.dispose()
}

function nativeOperation(
  cohort: Cohort,
  operation: (typeof nativeOperations)[number],
): Uint8Array | number {
  if (operation === 'native-key') return cohort.session.key(key)
  if (operation === 'native-text') return cohort.session.sendInput('t')
  if (operation === 'native-paste') return cohort.session.paste('p')
  if (operation === 'native-write') return cohort.session.write('\rprocess-write').revision
  return cohort.session.geometry().columns
}

async function timingBlock(): Promise<void> {
  const bootstrap = await Cohort.create([])
  bootstrap.dispose()
  const repetitions = 2
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    for (const inert of [0, 1, 100, 1_000, 1_000, 100, 1, 0]) {
      const values = Array.from({ length: inert }, fresh)
      const start = performance.now()
      const cohort = await Cohort.create(values)
      rows.push({
        operation: 'internal-host-manager-create',
        inert,
        milliseconds: performance.now() - start,
        repetition,
      })
      cohort.dispose()
    }
    for (const inert of [0, 100, 1_000, 1_000, 100, 0]) await timeCohort(inert, repetition)
  }
}

async function timeCohort(inert: number, repetition: number): Promise<void> {
  const cohort = await Cohort.create(Array.from({ length: inert }, fresh))
  const coldTarget = fresh()
  let start = performance.now()
  const cold = cohort.manager.use(coldTarget)
  rows.push({
    operation: 'cold-internal-first-use',
    inert,
    milliseconds: performance.now() - start,
    repetition,
  })
  cold.dispose()
  cohort.warmZero(inert)
  const manager = cohort.manager
  const operations = 2_000
  let useMilliseconds = 0
  let disposeMilliseconds = 0
  for (let index = 0; index < operations; index += 1) {
    const target = fresh()
    start = performance.now()
    const handle = manager.use(target)
    useMilliseconds += performance.now() - start
    start = performance.now()
    handle.dispose()
    disposeMilliseconds += performance.now() - start
  }
  rows.push({
    operation: 'manager-use-fresh',
    inert,
    milliseconds: useMilliseconds,
    operations,
    repetition,
  })
  rows.push({
    operation: 'manager-dispose',
    inert,
    milliseconds: disposeMilliseconds,
    operations,
    repetition,
  })
  for (const operation of inputOperations) {
    let claims = 0
    start = performance.now()
    for (let index = 0; index < operations; index += 1)
      claims += Number(manager.dispatchInput(inputs[operation]))
    rows.push({ operation, inert, milliseconds: performance.now() - start, operations, repetition })
    assert.equal(claims, 0)
  }
  let payloadCalls = 0
  const payload = () => {
    payloadCalls += 1
    return { rows: cohort.session.renderState.readRows().map((row) => row.y) }
  }
  start = performance.now()
  for (let index = 0; index < operations; index += 1) manager.emit('frame', payload)
  rows.push({
    operation: 'manager-frame',
    inert,
    milliseconds: performance.now() - start,
    operations,
    repetition,
  })
  assert.equal(payloadCalls, 0)
  for (const operation of nativeOperations) {
    let result: Uint8Array | number = 0
    start = performance.now()
    for (let index = 0; index < operations; index += 1) result = nativeOperation(cohort, operation)
    rows.push({ operation, inert, milliseconds: performance.now() - start, operations, repetition })
    if (operation === 'native-geometry') assert.equal(result, 80)
    if (operation === 'native-write') {
      assert(cohort.session.readLines(0, 1).some((line) => line.text.includes('process-write')))
      continue
    }
    if (operation === 'native-geometry') continue
    const expected = { 'native-key': 'a', 'native-text': 't', 'native-paste': 'p' }[operation]
    assert.equal(new TextDecoder().decode(result as Uint8Array), expected)
  }
  cohort.dispose()
}

try {
  if (mode === 'block') await timingBlock()
  if (mode !== 'block') await counterMatrix()
  assert.deepEqual(errors, [])
} finally {
  await writeFile(
    join(output, `${mode}.json`),
    JSON.stringify(
      {
        label: 'X6 in-process timing',
        scope:
          'Internal direct manager/native operations on actual main; current public activation is absent.',
        pending: [
          'public use/dispose',
          'public creation N',
          'public original-input interception',
          'public write/frame extension route',
          'custom OSC native/public',
        ],
        environment: { browser: 'N/A', headless: 'N/A', argv: process.argv, node: process.version },
        rows,
      },
      null,
      2,
    ),
  )
}
