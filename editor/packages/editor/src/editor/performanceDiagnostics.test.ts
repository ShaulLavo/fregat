import { afterEach, expect, test, vi } from 'vitest'
import {
  beginEditorPerformanceBatch,
  beginEditorPerformanceCommand,
  beginEditorPerformancePass,
  beginEditorPerformanceInput,
  beginEditorPerformanceView,
  editorPerformanceDiagnosticsEnabled,
  endEditorPerformanceInput,
  endEditorPerformanceScope,
  measureEditorPerformance,
  recordEditorPerformanceDiagnostic,
  traceEditorInput,
  traceEditorPerformanceTask,
  type EditorPerformanceDiagnostic,
} from './performanceDiagnostics'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test('disabled diagnostics allocate no payloads, read no clock, and keep deferred callbacks intact', () => {
  const record = vi.fn()
  const detail = vi.fn(() => ({ unexpected: true }))
  const clock = vi.spyOn(performance, 'now')
  const run = vi.fn((value: number) => value + 1)
  const input = traceEditorInput('input.beforeinput', run)
  vi.stubGlobal('__EDITOR_PERFORMANCE_DIAGNOSTICS__', { enabled: false, record })

  expect(editorPerformanceDiagnosticsEnabled()).toBe(false)
  expect(beginEditorPerformanceBatch()).toBeNull()
  expect(beginEditorPerformanceCommand('undo')).toBeNull()
  expect(beginEditorPerformancePass()).toBeNull()
  expect(input(4)).toBe(5)
  expect(beginEditorPerformanceView('view', 'doc', 1, 2)).toBeNull()
  expect(traceEditorPerformanceTask('deferred', run)).toBe(run)
  expect(measureEditorPerformance('phase', () => 3, detail)).toBe(3)
  recordEditorPerformanceDiagnostic('phase', detail)

  expect(detail).not.toHaveBeenCalled()
  expect(record).not.toHaveBeenCalled()
  expect(clock).not.toHaveBeenCalled()
})

test('input, commit, and two affected views share a scalar operation identity', () => {
  const records: EditorPerformanceDiagnostic[] = []
  vi.stubGlobal('__EDITOR_PERFORMANCE_DIAGNOSTICS__', (event: EditorPerformanceDiagnostic) =>
    records.push(event),
  )
  let time = 100
  vi.spyOn(performance, 'now').mockImplementation(() => time)
  const input = beginEditorPerformanceInput('input.beforeinput')
  const first = beginEditorPerformanceView('first', 'doc', 1, 8)
  recordEditorPerformanceDiagnostic('committed')
  measureEditorPerformance('layout', () => {
    time += 7
  })
  endEditorPerformanceScope(first)
  const second = beginEditorPerformanceView('second', 'doc', 4, 8)
  recordEditorPerformanceDiagnostic('layout')
  endEditorPerformanceScope(second)
  endEditorPerformanceInput(input)
  recordEditorPerformanceDiagnostic('outside')

  const operation = records[0]?.operation
  expect(operation).toEqual({
    id: expect.any(Number),
    input: 'input.beforeinput',
    startedAtMs: 100,
  })
  expect(records.slice(0, 4).map((event) => event.operation)).toEqual(Array(4).fill(operation))
  expect(records[1]).toMatchObject({
    durationMs: 7,
    timestampMs: 107,
    view: { id: 'first', revision: 8 },
  })
  expect(records[2]?.view).toEqual({
    id: 'second',
    documentId: 'doc',
    documentVersion: 4,
    revision: 8,
  })
  expect(records[3]).toMatchObject({ name: 'editor.input', durationMs: 7 })
  expect(records[3]).not.toHaveProperty('view')
  expect(records[4]).not.toHaveProperty('operation')
})

test('deferred callbacks retain their originating revision and restore a later operation', async () => {
  const records: EditorPerformanceDiagnostic[] = []
  vi.stubGlobal('__EDITOR_PERFORMANCE_DIAGNOSTICS__', (event: EditorPerformanceDiagnostic) =>
    records.push(event),
  )
  const original = beginEditorPerformanceInput('first')
  const view = beginEditorPerformanceView('view', 'doc', 1, 8)
  const task = traceEditorPerformanceTask('deferred', async (value: number) => value + 1)
  endEditorPerformanceScope(view)
  endEditorPerformanceInput(original)
  const later = beginEditorPerformanceInput('second')
  const result = task(4)
  recordEditorPerformanceDiagnostic('later')
  endEditorPerformanceInput(later)
  expect(await result).toBe(5)

  expect(records.find((event) => event.name === 'deferred')).toMatchObject({
    operation: { input: 'first' },
    view: { documentVersion: 1, revision: 8 },
  })
  expect(records.find((event) => event.name === 'later')).toMatchObject({
    operation: { input: 'second' },
  })
  expect(records.find((event) => event.name === 'later')).not.toHaveProperty('view')
})

test('throwing input and deferred callbacks cannot leak context into unrelated work', () => {
  const records: EditorPerformanceDiagnostic[] = []
  vi.stubGlobal('__EDITOR_PERFORMANCE_DIAGNOSTICS__', (event: EditorPerformanceDiagnostic) =>
    records.push(event),
  )
  const failure = Symbol('failure')
  const input = traceEditorInput('input.beforeinput', () => {
    throw failure
  })
  expect(() => input(undefined)).toThrow(failure)
  recordEditorPerformanceDiagnostic('after-input')
  const scope = beginEditorPerformanceInput('origin')
  const task = traceEditorPerformanceTask('deferred', () => {
    throw failure
  })
  endEditorPerformanceInput(scope)
  expect(task).toThrow(failure)
  recordEditorPerformanceDiagnostic('after-task')

  expect(records.find((event) => event.name === 'after-input')).not.toHaveProperty('operation')
  expect(records.find((event) => event.name === 'after-task')).not.toHaveProperty('operation')
  expect(records.find((event) => event.name === 'deferred')).toMatchObject({
    operation: { input: 'origin' },
  })
})
