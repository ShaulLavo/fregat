import { QueryClient } from '@tanstack/react-query'
import { summarizeDiagnostics } from '@singapore-editor/lsp-plugin/diagnostics'
import { expect, test } from '../../../../test/fixtures'
import { testScopedStorage } from '../../../../test/factories/scoped-storage'
import {
  captureDiagnostics,
  captureDiagnosticsScroll,
  diagnosticsReloadOwner,
  prepareDiagnosticsReload,
  savedDiagnostics,
} from '@/features/workbench/state/diagnostics-reload'

const summary = summarizeDiagnostics('file:///repo/a.ts', 1, [
  {
    message: 'Example diagnostic',
    severity: 1,
    range: { start: { line: 2, character: 0 }, end: { line: 2, character: 3 } },
  },
])

test('saved diagnostics paint before attachment and require the same file revision at takeover', () => {
  const owner = new QueryClient()
  prepareDiagnosticsReload(owner, testScopedStorage, 'repo')
  captureDiagnostics(owner, diagnosticsReloadOwner(owner), 'repo/a.ts', 'revision-1', summary, 120)
  const next = new QueryClient()
  prepareDiagnosticsReload(next, testScopedStorage, 'repo')
  expect(savedDiagnostics(next, 'repo/a.ts', null, false)).toMatchObject({
    scrollTop: 120,
    summary: { counts: { error: 1 } },
  })
  expect(savedDiagnostics(next, 'repo/other.ts', null, false)).toBeNull()
  expect(
    savedDiagnostics(next, 'repo/a.ts', 'revision-1', false)?.summary?.diagnostics,
  ).toHaveLength(1)
  expect(next.getQueryCache().getAll()).toHaveLength(0)
  expect(savedDiagnostics(next, 'repo/a.ts', 'revision-2', false)).toBeNull()
  expect(testScopedStorage.getItem('diagnostics.display.v1')).toBeNull()
})

test('dirty documents and switched roots cannot use saved diagnostic authority', () => {
  const owner = new QueryClient()
  prepareDiagnosticsReload(owner, testScopedStorage, 'repo')
  const target = diagnosticsReloadOwner(owner)
  captureDiagnostics(owner, target, 'repo/a.ts', 'r1', summary, 0)
  expect(savedDiagnostics(owner, 'repo/a.ts', 'r1', true)).toBeNull()
  prepareDiagnosticsReload(owner, testScopedStorage, 'other')
  captureDiagnostics(owner, target, 'repo/a.ts', 'r1', summary, 0)
  expect(savedDiagnostics(owner, 'repo/a.ts', null, false)).toBeNull()
})

test('pending diagnostics scroll updates only the bound saved view, retaining its observation and revision', () => {
  const owner = new QueryClient()
  prepareDiagnosticsReload(owner, testScopedStorage, 'repo')
  captureDiagnostics(owner, diagnosticsReloadOwner(owner), 'repo/a.ts', 'r1', summary, 120)
  const observed = JSON.parse(testScopedStorage.getItem('diagnostics.display.v1')!)
  const pending = new QueryClient()
  prepareDiagnosticsReload(pending, testScopedStorage, 'repo')
  const target = diagnosticsReloadOwner(pending)
  captureDiagnosticsScroll(pending, target, 'repo/a.ts', 740)
  expect(JSON.parse(testScopedStorage.getItem('diagnostics.display.v1')!)).toEqual({
    ...observed,
    scrollTop: 740,
  })
  expect(pending.getQueryCache().getAll()).toHaveLength(0)
  captureDiagnosticsScroll(pending, target, 'repo/other.ts', 900)
  expect(savedDiagnostics(pending, 'repo/a.ts', null, false)?.scrollTop).toBe(740)
  prepareDiagnosticsReload(pending, testScopedStorage, 'other')
  captureDiagnosticsScroll(pending, target, 'repo/a.ts', 900)
  expect(savedDiagnostics(pending, 'repo/a.ts', null, false)).toBeNull()
})
