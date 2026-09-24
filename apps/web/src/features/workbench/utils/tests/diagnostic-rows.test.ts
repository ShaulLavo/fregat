import { summarizeDiagnostics } from '@singapore-editor/lsp-plugin/diagnostics'
import type { LanguageServerDiagnosticSummary } from '@singapore-editor/lsp-plugin/websocket'

import { diagnosticRows, survivingActiveId } from '@/features/workbench/utils/diagnostic-rows'
import type { MarkerResource } from '@/lib/markers/store'
import { expect, test } from '../../../../../test/fixtures'

type Diagnostic = LanguageServerDiagnosticSummary['diagnostics'][number]

function diagnostic(
  line: number,
  message: string,
  severity: Diagnostic['severity'] = 1,
): Diagnostic {
  return {
    message,
    range: { end: { character: 4, line }, start: { character: 0, line } },
    severity,
  }
}

function resource(path: string, diagnostics: Diagnostic[]): MarkerResource {
  const uri = `file:///${path}`
  return {
    path,
    summary: summarizeDiagnostics(uri, null, diagnostics),
    uri,
  }
}

const TWO_FILES = [
  resource('src/a.ts', [diagnostic(1, 'Same message'), diagnostic(9, 'Same message', 2)]),
  resource('src/b.ts', [diagnostic(1, 'Same message')]),
]

test('files and their diagnostics form one sequence', () => {
  const rows = diagnosticRows(TWO_FILES, new Set())

  expect(rows.map((row) => row.kind)).toEqual([
    'group',
    'diagnostic',
    'diagnostic',
    'group',
    'diagnostic',
  ])
  expect(rows[1]?.kind === 'diagnostic' && rows[1].parentId).toBe(rows[0]?.id)
})

test('the same message at another location or in another file has its own id', () => {
  const ids = diagnosticRows(TWO_FILES, new Set()).map((row) => row.id)

  expect(new Set(ids).size).toBe(ids.length)
})

test('an exact repeat is told apart by occurrence', () => {
  const rows = diagnosticRows(
    [resource('src/a.ts', [diagnostic(1, 'Twice'), diagnostic(1, 'Twice')])],
    new Set(),
  )

  expect(rows[1]?.id).not.toBe(rows[2]?.id)
})

test('a row keeps its id when another file changes', () => {
  const before = diagnosticRows(TWO_FILES, new Set())
  const after = diagnosticRows(
    [resource('src/a.ts', [diagnostic(9, 'Same message', 2)]), TWO_FILES[1]!],
    new Set(),
  )

  expect(after.at(-1)?.id).toBe(before.at(-1)?.id)
})

test('a collapsed file keeps its heading and hides its diagnostics', () => {
  const rows = diagnosticRows(TWO_FILES, new Set(['file:///src/a.ts']))

  expect(rows.map((row) => row.kind)).toEqual(['group', 'group', 'diagnostic'])
  expect(rows[0]?.kind === 'group' && rows[0].expanded).toBe(false)
})

test('the active row survives a refresh that keeps it', () => {
  const rows = diagnosticRows(TWO_FILES, new Set())

  expect(survivingActiveId(rows, { id: rows[4]!.id, index: 4 })).toBe(rows[4]!.id)
})

test('a removed active row hands off to the row now in its place', () => {
  const before = diagnosticRows(TWO_FILES, new Set())
  const after = diagnosticRows([TWO_FILES[1]!], new Set())

  expect(survivingActiveId(after, { id: before[2]!.id, index: 2 })).toBe(after.at(-1)?.id)
  expect(survivingActiveId([], { id: before[2]!.id, index: 2 })).toBeNull()
})
