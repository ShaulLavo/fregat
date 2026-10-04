import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { x6Protocol } from '../../scripts/ghostty-x6-public-statistics.js'
import {
  epochNanoseconds,
  type ClockAnchor,
  type StopwatchSlice,
} from '../../scripts/ghostty-x6-public-overlap.js'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Terminal } from '../src/dom/terminal.js'
import type { Extension, ExtensionHandle, TerminalInputEvent } from '../src/extensions/types.js'
import { DomTerminalRenderer } from '../src/render/dom/renderer.js'
import { createNodeClock, createNodePlatform } from './extension-node-platform.js'

const [output, mode, root, fontFile, productHead, authorizationFile] = process.argv.slice(2)
assert(output && root && fontFile && productHead)
assert(
  mode === 'counters' ||
    mode === 'smoke' ||
    mode === 'diagnostic' ||
    mode === 'startup' ||
    mode === 'block',
)
const platform = await createNodePlatform(root, fontFile)
await writeFile(join(output, 'platform-inputs.json'), JSON.stringify(platform.inputs, null, 2))
const state = globalThis as typeof globalThis & { __x6Owned?: Record<string, number> }
let setupCalls = 0
let contributionFactories = 0
let serial = 0
let factoryCalls: Record<string, number> = {}
const identities = new WeakSet<Extension>()
const scopeIdentities = new WeakSet<object>()
const handleIdentities = new WeakSet<object>()
const rows: object[] = []
const controlRows: object[] = []
const controlIntervals: {
  inert: number
  startedAtMilliseconds: number
  endedAtMilliseconds: number
}[] = []
const clockAnchors: ClockAnchor[] = []
const originNanoseconds = epochNanoseconds(performance.timeOrigin)
const active = new Set<Cohort>()
const hostErrorSentinel = Object.freeze({ fixture: 'public shortcut failure' })
const key = { action: 'press' as const, code: 'KeyA', text: 'a', composing: false }
const inputs = [
  'public-api-key',
  'public-api-text',
  'public-api-paste',
  'public-dom-key',
  'public-dom-text',
  'public-dom-paste',
  'public-dom-composition',
] as const
const native = ['public-write', 'public-write-frame', 'public-geometry'] as const
const steady = ['public-use-fresh', 'public-dispose', ...inputs, ...native] as const
const expectedInput = ['a', 't', 'p', 'b', 'u', 'q', '界']

function record<T extends { readonly operation: string }>(row: T): void {
  if (
    mode === 'block' &&
    (row.operation.startsWith('positive-') || row.operation.startsWith('negative-'))
  ) {
    controlRows.push(row)
    return
  }
  rows.push(row)
}

function fresh(): Extension {
  const extension: Extension = {
    name: `fresh-${serial++}`,
    setup(scope) {
      assert(!scopeIdentities.has(scope), 'Fresh scope identity')
      scopeIdentities.add(scope)
      setupCalls++
      contributionFactories++
      return {}
    },
  }
  assert(!identities.has(extension), 'Fresh extension identity')
  identities.add(extension)
  return extension
}

function resetCounts(): void {
  state.__x6Owned = Object.create(null) as Record<string, number>
  setupCalls = 0
  contributionFactories = 0
  factoryCalls = {}
}

function capture(operation: string, inert: number) {
  return {
    operation,
    inert,
    counts: { ...state.__x6Owned },
    setupCalls,
    contributionFactories,
    externalProducerFactories: { ...factoryCalls },
  }
}

function factory(name: string): void {
  factoryCalls[name] = (factoryCalls[name] ?? 0) + 1
}

function terminalOptions(
  values: readonly Extension[],
  clock: ReturnType<typeof createNodeClock>,
): NonNullable<Parameters<typeof Terminal.create>[0]> {
  return {
    extensions: values,
    appearance: {
      font: { family: platform.fixtureFamily, size: 16 },
      cursor: { blink: false },
      grid: { columns: 80, rows: 12 },
    },
    accessibility: false,
    keyboard: {
      shortcuts: [
        {
          hotkey: 'Control+Shift+C',
          id: 'fixture-error',
          onTrigger() {
            throw hostErrorSentinel
          },
        },
      ],
    },
    rendererFactory: (options) =>
      DomTerminalRenderer.create({ ...options, schedulerClock: clock.clock }),
    runtime: {
      kind: 'owned',
      options: {
        wasm: pathToFileURL(join(output!, 'ghostty-vt.wasm')),
        bridge: pathToFileURL(join(output!, 'bridge.wasm')),
      },
    },
  }
}

async function createTerminal(
  values: readonly Extension[],
  clock: ReturnType<typeof createNodeClock>,
) {
  return Terminal.create(terminalOptions(values, clock))
}

class Cohort {
  readonly parent = document.createElement('div')
  readonly errors: { cause: unknown; operation: string }[] = []
  readonly data: Uint8Array[] = []
  frameWrites = 0
  disposed = false

  constructor(
    readonly terminal: Terminal,
    readonly clock: ReturnType<typeof createNodeClock>,
  ) {
    document.body.append(this.parent)
    terminal.on('error', (error) => this.errors.push(error))
    terminal.onData((data) => this.data.push(data))
    active.add(this)
  }

  static async create(inert: number): Promise<Cohort> {
    const clock = createNodeClock()
    const terminal = await createTerminal(Array.from({ length: inert }, fresh), clock)
    const cohort = new Cohort(terminal, clock)
    await cohort.open()
    return cohort
  }

  async open(): Promise<void> {
    await this.terminal.open(this.parent)
    await Promise.resolve()
    this.clock.drain()
    assert.equal(this.terminal.lifecycle, 'open')
    assert.equal(this.terminal.diagnostics.rendererBackend, 'dom')
  }

  use(extension: Extension): ExtensionHandle {
    const handle = this.terminal.use(extension)
    assert(!handleIdentities.has(handle), 'Fresh public handle identity')
    handleIdentities.add(handle)
    return handle
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.terminal.dispose()
    this.clock.close()
    this.parent.remove()
    active.delete(this)
  }
}

function input(cohort: Cohort, operation: (typeof inputs)[number]): Uint8Array | undefined {
  const terminal = cohort.terminal
  if (operation === 'public-api-key') return terminal.key(key)
  if (operation === 'public-api-text') return terminal.sendInput('t')
  if (operation === 'public-api-paste') return terminal.paste('p')
  const textarea = terminal.textarea!
  if (operation === 'public-dom-key') {
    factory('KeyboardEvent')
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', bubbles: true, cancelable: true }),
    )
    return
  }
  if (operation === 'public-dom-text') {
    factory('InputEvent')
    textarea.value = 'u'
    textarea.dispatchEvent(
      new InputEvent('input', { data: 'u', inputType: 'insertText', bubbles: true }),
    )
    return
  }
  if (operation === 'public-dom-paste') {
    factory('DataTransfer')
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', 'q')
    factory('ClipboardEvent')
    textarea.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
    )
    return
  }
  factory('CompositionEvent')
  textarea.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }))
  textarea.value = '界'
  factory('InputEvent')
  textarea.dispatchEvent(
    new InputEvent('input', {
      data: '界',
      inputType: 'insertCompositionText',
      isComposing: true,
      bubbles: true,
    }),
  )
  factory('CompositionEvent')
  textarea.dispatchEvent(new CompositionEvent('compositionend', { data: '界', bubbles: true }))
}

function nativeOperation(cohort: Cohort, operation: (typeof native)[number]): number {
  if (operation === 'public-geometry') return cohort.terminal.geometry().columns
  if (operation === 'public-write')
    return cohort.terminal.write('\r\x1b[2Kx6-public-write').revision
  const suffix = cohort.frameWrites++ % 2 === 0 ? 'A' : 'B'
  const result = cohort.terminal.write(`\r\x1b[2Kx6-public-frame-${suffix}`)
  cohort.clock.drain()
  return result.revision
}

function decoded(values: readonly Uint8Array[]): string[] {
  return values.map((value) => new TextDecoder().decode(value))
}

function checkInput(
  cohort: Cohort,
  operation: (typeof inputs)[number],
  before: number,
  result?: Uint8Array,
): void {
  const expected = expectedInput[inputs.indexOf(operation)]!
  assert.deepEqual(decoded(cohort.data.slice(before)), [expected], operation)
  if (result) assert.equal(new TextDecoder().decode(result), expected, operation)
}

async function counters(): Promise<void> {
  const bootstrap = await Cohort.create(0)
  bootstrap.dispose()
  for (const inert of [0, 1, 100, 1_000]) {
    const values = Array.from({ length: inert }, fresh)
    const clock = createNodeClock()
    resetCounts()
    const terminal = await createTerminal(values, clock)
    record({ ...capture('public-create', inert), freshIdentities: values.length })
    assert.equal(setupCalls, inert)
    const cohort = new Cohort(terminal, clock)
    resetCounts()
    await cohort.open()
    record(capture('cold-public-open', inert))
    cohort.dispose()
  }
  for (const inert of [0, 100, 1_000]) await counterCohort(inert)
}

async function counterCohort(inert: number): Promise<void> {
  const cohort = await Cohort.create(inert)
  const coldTarget = fresh()
  resetCounts()
  const cold = cohort.use(coldTarget)
  record(capture('cold-public-first-use', inert))
  cold.dispose()
  const target = fresh()
  resetCounts()
  const handle = cohort.use(target)
  record(capture('public-use-fresh', inert))
  assert.equal(setupCalls, 1)
  resetCounts()
  handle.dispose()
  record({ ...capture('public-dispose', inert), otherInstalledInert: inert })
  const same = fresh()
  cohort.use(same).dispose()
  resetCounts()
  const sameHandle = cohort.use(same)
  record(capture('public-use-same', inert))
  resetCounts()
  sameHandle.dispose()
  record({ ...capture('public-dispose-same', inert), otherInstalledInert: inert })
  const churn = Array.from({ length: 32 }, fresh)
  resetCounts()
  for (const extension of churn) cohort.use(extension).dispose()
  record({ ...capture('public-own-key-churn', inert), operations: churn.length })
  for (const operation of inputs) {
    cohort.clock.drain()
    const before = cohort.data.length
    resetCounts()
    const result = input(cohort, operation)
    record({ ...capture(operation, inert), nativeDataCalls: cohort.data.length - before })
    checkInput(cohort, operation, before, result)
  }
  for (const operation of native) {
    cohort.clock.drain()
    resetCounts()
    const result = nativeOperation(cohort, operation)
    record({ ...capture(operation, inert), result })
    if (operation === 'public-geometry') assert.equal(result, 80)
    if (operation === 'public-write')
      assert(cohort.terminal.readLines(0, 1).some((line) => line.text.includes('x6-public-write')))
    if (operation === 'public-write-frame')
      assert(cohort.parent.textContent?.includes('x6-public-frame-A'))
  }
  assert.deepEqual(cohort.errors, [])
  await positive(cohort, inert)
  oscNegative(cohort, inert)
  cohort.dispose()
}

async function positive(cohort: Cohort, inert: number): Promise<void> {
  const observed: TerminalInputEvent[] = []
  const events: Record<string, number> = {}
  let cleanupCalls = 0
  let claims = false
  const handle = cohort.terminal.use({
    name: 'positive',
    setup(scope) {
      scope.own(() => {
        cleanupCalls++
      })
      return {
        api: { geometry: () => scope.terminal.geometry() },
        input(event) {
          observed.push(event)
          return claims ? 'claim' : 'pass'
        },
        events: {
          data: () => {
            events.data = (events.data ?? 0) + 1
          },
          frame: (event) => {
            assert(event.rows.length > 0)
            events.frame = (events.frame ?? 0) + 1
          },
          title: () => {
            events.title = (events.title ?? 0) + 1
          },
          bell: () => {
            events.bell = (events.bell ?? 0) + 1
          },
          appearance: () => {
            events.appearance = (events.appearance ?? 0) + 1
          },
          resize: () => {
            events.resize = (events.resize ?? 0) + 1
          },
          scroll: () => {
            events.scroll = (events.scroll ?? 0) + 1
          },
          selection: () => {
            events.selection = (events.selection ?? 0) + 1
          },
          error: () => {
            events.error = (events.error ?? 0) + 1
          },
        },
      }
    },
  })
  const before = cohort.data.length
  resetCounts()
  for (const operation of inputs) input(cohort, operation)
  record({
    ...capture('positive-input-pass', inert),
    inputCalls: observed.length,
    eventKinds: observed.map((event) => event.type),
    nativeDataCalls: cohort.data.length - before,
  })
  assert.equal(observed.length, inputs.length)
  assert.deepEqual(decoded(cohort.data.slice(before)), expectedInput)
  const domKey = observed.find((event) => event.type === 'key' && 'event' in event)
  assert(domKey?.type === 'key' && 'event' in domKey)
  assert.equal(domKey.event.code, 'KeyB')
  claims = true
  const claimedBefore = cohort.data.length
  const claimedInputs = observed.length
  resetCounts()
  for (const operation of inputs) {
    const result = input(cohort, operation)
    if (result) assert.equal(result.length, 0)
  }
  record({
    ...capture('positive-input-claim', inert),
    inputCalls: observed.length - claimedInputs,
    nativeDataCalls: cohort.data.length - claimedBefore,
  })
  assert.equal(observed.length - claimedInputs, inputs.length)
  assert.equal(cohort.data.length, claimedBefore)
  claims = false
  cohort.clock.drain()
  resetCounts()
  nativeOperation(cohort, 'public-write-frame')
  const geometry = await handle.api.geometry()
  record({
    ...capture('positive-frame-geometry', inert),
    frameCalls: events.frame,
    geometryColumns: geometry.columns,
  })
  assert((events.frame ?? 0) > 0)
  assert.equal(geometry.columns, 80)
  resetCounts()
  cohort.terminal.write('\u0007\x1b]2;x6-native-title\u0007')
  cohort.terminal.setFont({ size: 17 })
  cohort.terminal.setAppearance({ grid: { columns: 81, rows: 12 } })
  cohort.terminal.selectRange({ x: 0, y: 0 }, { x: 1, y: 0 })
  cohort.terminal.write('\r\n'.repeat(20))
  cohort.terminal.scrollToTop()
  cohort.clock.drain()
  record({ ...capture('positive-native-events', inert), events: { ...events } })
  for (const event of [
    'data',
    'frame',
    'title',
    'bell',
    'appearance',
    'resize',
    'selection',
    'scroll',
  ])
    assert((events[event] ?? 0) > 0, `Observable ${event} event`)
  const sentinel = Object.freeze({ fixture: 'input failure' })
  const failing = cohort.terminal.use({
    name: 'failing-input',
    setup: () => ({
      input: () => {
        throw sentinel
      },
    }),
  })
  resetCounts()
  const errorBefore = cohort.errors.length
  assert.equal(new TextDecoder().decode(cohort.terminal.sendInput('e')), 'e')
  record({
    ...capture('positive-input-error', inert),
    errorCalls: cohort.errors.length - errorBefore,
    extensionErrorCalls: events.error ?? 0,
    scope: 'Handler failures reach host diagnostics without recursive extension error redispatch',
  })
  assert.equal(cohort.errors.at(-1)?.cause, sentinel)
  assert.equal(cohort.errors.length - errorBefore, 1)
  failing.dispose()
  const hostErrorBefore = cohort.errors.length
  resetCounts()
  factory('KeyboardEvent')
  cohort.terminal.textarea!.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'C',
      code: 'KeyC',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  )
  record({
    ...capture('positive-host-error-event', inert),
    errorCalls: cohort.errors.length - hostErrorBefore,
    extensionErrorCalls: events.error ?? 0,
  })
  assert.equal(cohort.errors.at(-1)?.cause, hostErrorSentinel)
  assert.equal(cohort.errors.length - hostErrorBefore, 1)
  assert.equal(events.error, 1)
  resetCounts()
  handle.dispose()
  record({ ...capture('positive-dispose', inert), cleanupCalls })
  assert.equal(cleanupCalls, 1)
  await positiveLinks(cohort, inert)
  positiveCommands(cohort, inert)
}

async function positiveLinks(cohort: Cohort, inert: number): Promise<void> {
  let providerCalls = 0
  let cleanupCalls = 0
  cohort.terminal.write('\x1b[Hlink')
  cohort.clock.drain()
  // First-hit provider priority requires independent positive controls.
  let classicProviderCalls = 0
  const classic = cohort.terminal.registerLinkProvider({
    provideLinks() {
      classicProviderCalls++
      return [{ range: { start: 0, end: 3 }, text: 'link', activate() {} }]
    },
  })
  const classicFocused = await cohort.terminal.focusNextLink()
  classic.dispose()
  const handle = cohort.terminal.use({
    name: 'positive-links',
    setup(scope) {
      scope.own(() => {
        cleanupCalls++
      })
      return {
        links: {
          provideLinks() {
            providerCalls++
            return [{ range: { start: 0, end: 3 }, text: 'link', activate() {} }]
          },
        },
      }
    },
  })
  resetCounts()
  const focused = await cohort.terminal.focusNextLink()
  record({ ...capture('positive-links', inert), providerCalls, focused })
  await writeFile(
    join(output!, `link-diagnostic-${inert}.json`),
    JSON.stringify(
      {
        providerCalls,
        focused,
        classicProviderCalls,
        classicFocused,
        publicDiagnostics: cohort.terminal.diagnostics,
        submittedFrame: cohort.terminal.submittedFrame,
        sourceProduct: productHead,
        browser: 'N/A',
        presentedFrames: 'UNKNOWN',
      },
      null,
      2,
    ),
  )
  assert(classicProviderCalls > 0, 'Known-good public provider must be observable')
  assert.equal(classicFocused, true)
  assert(providerCalls > 0)
  assert.equal(focused, true)
  handle.dispose()
  assert.equal(cleanupCalls, 1)
}

function positiveCommands(cohort: Cohort, inert: number): void {
  let cleanupCalls = 0
  const owner = cohort.terminal.use({
    name: 'command-owner',
    setup: () => ({ commands: { x6() {} } }),
  })
  const errors = cohort.errors.length
  resetCounts()
  assert.throws(() =>
    cohort.terminal.use({
      name: 'command-conflict',
      setup(scope) {
        scope.own(() => {
          cleanupCalls++
        })
        return { commands: { x6() {} } }
      },
    }),
  )
  record({
    ...capture('positive-command-exclusive-rollback', inert),
    cleanupCalls,
    errorCalls: cohort.errors.length - errors,
    dispatch: 'No public command-dispatch API; registration/exclusivity/rollback only',
  })
  assert.equal(cleanupCalls, 1)
  assert.equal(cohort.errors.length - errors, 1)
  owner.dispose()
}

function oscNegative(cohort: Cohort, inert: number): void {
  let cleanupCalls = 0
  let observerCalls = 0
  const before = cohort.errors.length
  resetCounts()
  assert.throws(
    () =>
      cohort.terminal.use({
        name: 'unsupported-osc',
        setup(scope) {
          scope.own(() => {
            cleanupCalls++
          })
          return {
            osc: {
              777: () => {
                observerCalls++
              },
            },
          }
        },
      }),
    /Custom OSC observation is unavailable/,
  )
  record({
    ...capture('negative-public-osc-capability', inert),
    cleanupCalls,
    observerCalls,
    errorCalls: cohort.errors.length - before,
    positive: 'PENDING — nonblocking',
  })
  assert.equal(cleanupCalls, 1)
  assert.equal(observerCalls, 0)
  assert.equal(cohort.errors.length - before, 1)
}

function anchorClock(): void {
  const beforeMonotonicMilliseconds = performance.now()
  const epochMilliseconds = Date.now()
  const afterMonotonicMilliseconds = performance.now()
  clockAnchors.push({ beforeMonotonicMilliseconds, afterMonotonicMilliseconds, epochMilliseconds })
}

function stopwatchSlice(start: number, end: number): StopwatchSlice {
  return {
    startedAtMonotonicMilliseconds: start,
    endedAtMonotonicMilliseconds: end,
    startedAtNanoseconds: String(originNanoseconds + epochNanoseconds(start)),
    endedAtNanoseconds: String(originNanoseconds + epochNanoseconds(end)),
  }
}

function recordTiming(
  operation: string,
  inert: number,
  repetition: number,
  slices: readonly StopwatchSlice[],
  operations = 1,
): void {
  assert(slices.length > 0)
  record({
    operation,
    inert,
    repetition,
    operations,
    slices,
    milliseconds: slices.reduce(
      (total, slice) =>
        total + (slice.endedAtMonotonicMilliseconds - slice.startedAtMonotonicMilliseconds),
      0,
    ),
    startedAtMilliseconds: performance.timeOrigin + slices[0]!.startedAtMonotonicMilliseconds,
    endedAtMilliseconds: performance.timeOrigin + slices.at(-1)!.endedAtMonotonicMilliseconds,
  })
}

async function authorizeTiming(): Promise<void> {
  assert(authorizationFile, 'Independent registration authorization required before timing')
  const authorization = JSON.parse(await readFile(authorizationFile, 'utf8')) as {
    sourceProduct: string
    bundleSha256: string
    reviewReference: string
    registrationFile: string
    registrationSha256: string
    bundleKind: string
  }
  assert.equal(authorization.sourceProduct, productHead)
  assert.match(authorization.registrationSha256, /^[0-9a-f]{64}$/)
  assert(authorization.reviewReference.startsWith('https://github.com/ShaulLavo/fregat/'))
  assert.equal(authorization.bundleKind, 'uninstrumented')
  const registrationBytes = await readFile(authorization.registrationFile)
  assert.equal(
    createHash('sha256').update(registrationBytes).digest('hex'),
    authorization.registrationSha256,
  )
  const registration = JSON.parse(registrationBytes.toString()) as {
    actualBase: string
    counterVerificationFile: string
    counterVerificationSha256: string
    bundleSha256: string
    protocol: typeof x6Protocol
  }
  assert.equal(registration.actualBase, productHead)
  assert.equal(registration.bundleSha256, authorization.bundleSha256)
  assert.deepEqual(registration.protocol, x6Protocol)
  const counters = await readFile(registration.counterVerificationFile)
  assert.equal(
    createHash('sha256').update(counters).digest('hex'),
    registration.counterVerificationSha256,
  )
  assert.equal((JSON.parse(counters.toString()) as { passed: boolean }).passed, true)
  const actualBundle = createHash('sha256')
    .update(await readFile(process.argv[1]!))
    .digest('hex')
  assert.equal(actualBundle, authorization.bundleSha256, 'Exact authorized uninstrumented bundle')
}

async function timingBlock(): Promise<void> {
  state.__x6Owned = undefined
  const bootstrap = await Cohort.create(0)
  bootstrap.dispose()
  anchorClock()
  for (let repetition = 0; repetition < x6Protocol.repetitions; repetition++) {
    for (const inert of [0, 1, 100, 1_000, 1_000, 100, 1, 0])
      await timingCreation(inert, repetition)
    for (const inert of [0, 100, 1_000, 1_000, 100, 0]) await timingCohort(inert, repetition)
  }
  anchorClock()
  assert.equal(rows.length, 172)
}

async function timingCreation(inert: number, repetition: number): Promise<void> {
  const clock = createNodeClock()
  const options = terminalOptions(Array.from({ length: inert }, fresh), clock)
  const start = performance.now()
  const terminal = await Terminal.create(options)
  const end = performance.now()
  recordTiming('public-create', inert, repetition, [stopwatchSlice(start, end)])
  terminal.dispose()
  clock.close()
}

async function timingCohort(inert: number, repetition: number): Promise<void> {
  const cohort = await Cohort.create(inert)
  const target = fresh()
  const start = performance.now()
  const cold = cohort.use(target)
  const end = performance.now()
  recordTiming('cold-public-first-use', inert, repetition, [stopwatchSlice(start, end)])
  // This disposable first-use seed warms the zero cohort while leaving zero inert attachments.
  cold.dispose()
  timingLifecycle(cohort, inert, repetition)
  for (const operation of inputs) timingInput(cohort, operation, inert, repetition)
  for (const operation of native) timingNative(cohort, operation, inert, repetition)
  assert.deepEqual(cohort.errors, [])
  const controlStart = Date.now()
  await positive(cohort, inert)
  oscNegative(cohort, inert)
  controlIntervals.push({
    inert,
    startedAtMilliseconds: controlStart,
    endedAtMilliseconds: Date.now(),
  })
  cohort.dispose()
}

function timingLifecycle(cohort: Cohort, inert: number, repetition: number): void {
  const useSlices: StopwatchSlice[] = []
  const disposeSlices: StopwatchSlice[] = []
  for (let index = 0; index < x6Protocol.operationsPerObservation; index++) {
    const target = fresh()
    const useStart = performance.now()
    const handle = cohort.use(target)
    const useEnd = performance.now()
    const disposeStart = performance.now()
    handle.dispose()
    const disposeEnd = performance.now()
    useSlices.push(stopwatchSlice(useStart, useEnd))
    disposeSlices.push(stopwatchSlice(disposeStart, disposeEnd))
  }
  recordTiming(
    'public-use-fresh',
    inert,
    repetition,
    useSlices,
    x6Protocol.operationsPerObservation,
  )
  recordTiming(
    'public-dispose',
    inert,
    repetition,
    disposeSlices,
    x6Protocol.operationsPerObservation,
  )
}

function timingInput(
  cohort: Cohort,
  operation: (typeof inputs)[number],
  inert: number,
  repetition: number,
): void {
  cohort.clock.drain()
  cohort.data.length = 0
  let result: Uint8Array | undefined
  const start = performance.now()
  for (let index = 0; index < x6Protocol.operationsPerObservation; index++)
    result = input(cohort, operation)
  const end = performance.now()
  recordTiming(
    operation,
    inert,
    repetition,
    [stopwatchSlice(start, end)],
    x6Protocol.operationsPerObservation,
  )
  const expected = expectedInput[inputs.indexOf(operation)]!
  assert.equal(cohort.data.length, x6Protocol.operationsPerObservation)
  assert(
    decoded(cohort.data).every((value) => value === expected),
    operation,
  )
  if (result) assert.equal(new TextDecoder().decode(result), expected)
  cohort.data.length = 0
}

function timingNative(
  cohort: Cohort,
  operation: (typeof native)[number],
  inert: number,
  repetition: number,
): void {
  cohort.clock.drain()
  let result = 0
  const start = performance.now()
  for (let index = 0; index < x6Protocol.operationsPerObservation; index++)
    result = nativeOperation(cohort, operation)
  const end = performance.now()
  recordTiming(
    operation,
    inert,
    repetition,
    [stopwatchSlice(start, end)],
    x6Protocol.operationsPerObservation,
  )
  if (operation === 'public-geometry') {
    assert.equal(result, 80)
    return
  }
  const text = operation === 'public-write' ? 'x6-public-write' : 'x6-public-frame-B'
  assert(cohort.terminal.readLines(0, 1).some((line) => line.text.includes(text)))
  if (operation === 'public-write-frame') assert(cohort.parent.textContent?.includes(text))
}

async function startupReadback(): Promise<void> {
  state.__x6Owned = undefined
  const cohort = await Cohort.create(0)
  const handle = cohort.use(fresh())
  handle.dispose()
  for (const operation of inputs) {
    const before = cohort.data.length
    checkInput(cohort, operation, before, input(cohort, operation))
  }
  nativeOperation(cohort, 'public-write')
  assert(cohort.terminal.readLines(0, 1).some((line) => line.text.includes('x6-public-write')))
  nativeOperation(cohort, 'public-write-frame')
  nativeOperation(cohort, 'public-write-frame')
  assert(cohort.terminal.readLines(0, 1).some((line) => line.text.includes('x6-public-frame-B')))
  assert(cohort.parent.textContent?.includes('x6-public-frame-B'))
  assert.equal(nativeOperation(cohort, 'public-geometry'), 80)
  assert.deepEqual(cohort.errors, [])
  record({
    operation: 'startup-public-native-readback',
    inputBytes: decoded(cohort.data),
    diagnostics: cohort.terminal.diagnostics,
    geometry: cohort.terminal.geometry(),
    fixtureFamily: platform.fixtureFamily,
    nativeText: cohort.terminal.readLines(0, 1).map((line) => line.text),
    domText: cohort.parent.textContent,
    setupCalls,
    contributionFactories,
  })
  cohort.dispose()
}

function unitLabel(): string {
  if (mode === 'diagnostic')
    return 'UNMEASURED public command/OSC diagnostic — not full X6 matrix acceptance'
  if (mode === 'startup')
    return 'UNMEASURED frozen-launcher public/native/font readiness — zero performance observations'
  return 'Real-public X6 in-process producer/source unit'
}

async function diagnosticPreflights(): Promise<void> {
  for (const inert of [0, 100, 1_000]) {
    const cohort = await Cohort.create(inert)
    positiveCommands(cohort, inert)
    oscNegative(cohort, inert)
    cohort.dispose()
  }
}

try {
  if (mode === 'block') {
    await authorizeTiming()
    await timingBlock()
  } else if (mode === 'diagnostic') await diagnosticPreflights()
  else if (mode === 'startup') await startupReadback()
  else await counters()
} finally {
  for (const cohort of active) cohort.dispose()
  await writeFile(
    join(output, `${mode}.json`),
    JSON.stringify(
      {
        label: unitLabel(),
        performanceObservations: mode === 'block' ? rows.length : 0,
        productHead,
        scope:
          'Public Terminal.create/use/dispose and actual opened DOM/API input, native write/geometry and real renderer callback paths',
        sourceCounts:
          'Exact evaluated owned source expressions and calls; separate from external producer factories, VM/native allocations, and implicit iterators',
        pending: [
          'Custom OSC positive/counter path — PENDING, nonblocking',
          'Public command dispatch — no public API; exclusivity/rollback exercised',
        ],
        environment: {
          browser: 'N/A',
          headless: 'N/A',
          presentedFrames: 'UNKNOWN',
          node: process.version,
          argv: process.argv,
        },
        steady,
        clock: {
          timeOriginMilliseconds: performance.timeOrigin,
          timeOriginNanoseconds: String(originNanoseconds),
          anchors: clockAnchors,
        },
        bookkeeping:
          'Every lifecycle stopwatch slice is retained as integer epoch nanoseconds and original monotonic endpoints. Slice construction and timestamp/serialization allocations are outside stopwatches and identical across counts; they can affect later GC, with no correction.',
        controlRows,
        controlIntervals,
        rows,
      },
      null,
      2,
    ),
  )
  await platform.view.happyDOM.close()
}
