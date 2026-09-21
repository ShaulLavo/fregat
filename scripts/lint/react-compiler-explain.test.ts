import { expect, test } from 'vitest'

// @ts-expect-error The tool is a plain ES module and the scripts workspace has no `allowJs`.
import { auditManualMemos, explainSource } from './react-compiler-explain.mjs'

type Block = { readonly keys: readonly string[]; readonly yields: readonly string[] }
type Explained = {
  readonly functions: readonly {
    readonly name: string
    readonly compiled: boolean
    readonly blocks: readonly Block[]
  }[]
  readonly diagnostics: readonly string[]
}
type AuditRow = { readonly name: string; readonly verdict: string }

function source(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`
}

test('names what a memo block computes and the values that invalidate it', () => {
  const explained: Explained = explainSource(
    'probe.tsx',
    source([
      "import { expensive } from './expensive'",
      '',
      'export function Probe({ left, right }: { left: string; right: string }) {',
      '  const joined = expensive(left, right)',
      '  return <div>{joined}</div>',
      '}',
    ]),
  )

  const block = explained.functions[0]?.blocks.find((entry) => entry.yields.includes('joined'))
  expect(block?.keys).toEqual(['left', 'right'])
})

test('resolves a temporary key to the named values behind it', () => {
  const explained: Explained = explainSource(
    'probe.tsx',
    source([
      'export function Probe({ id }: { id: string }) {',
      '  const style = { color: id }',
      '  return <div style={style} />',
      '}',
    ]),
  )

  const keys = explained.functions[0]?.blocks.flatMap((block) => block.keys) ?? []
  expect(keys.every((key) => !/^t\d+$/.test(key))).toBe(true)
})

test('reports a refused component as not compiled, with the reason', () => {
  const explained: Explained = explainSource(
    'probe.tsx',
    source([
      "import { useRef } from 'react'",
      '',
      'export function Probe() {',
      '  const ref = useRef(0)',
      '  ref.current += 1',
      '  return <div>{ref.current}</div>',
      '}',
    ]),
  )

  expect(explained.functions[0]?.compiled).toBe(false)
  expect(explained.diagnostics[0]).toContain('Cannot access refs during render')
})

test('calls a manual memo redundant when the compiler picks the same keys', () => {
  const rows: readonly AuditRow[] = auditManualMemos(
    'probe.tsx',
    source([
      "import { useMemo } from 'react'",
      "import { expensive } from './expensive'",
      '',
      'export function Probe({ left, right }: { left: string; right: string }) {',
      '  const joined = useMemo(() => expensive(left, right), [left, right])',
      '  return <div>{joined}</div>',
      '}',
    ]),
  )

  expect(rows.map((row) => [row.name, row.verdict.split(':')[0]])).toEqual([
    ['joined', 'redundant'],
  ])
})

test('flags a manual memo whose keys the compiler would not choose', () => {
  const rows: readonly AuditRow[] = auditManualMemos(
    'probe.tsx',
    source([
      "import { useMemo } from 'react'",
      "import { expensive } from './expensive'",
      '',
      'export function Probe({ item }: { item: { id: string; label: string } }) {',
      '  const joined = useMemo(() => expensive(item.id, item.label), [item.id])',
      '  return <div>{joined}</div>',
      '}',
    ]),
  )

  expect(rows[0]?.verdict.split(':')[0]).toBe('differs')
})

test('never calls a memo redundant when a hook depends on the value', () => {
  const rows: readonly AuditRow[] = auditManualMemos(
    'probe.tsx',
    source([
      "import { useEffect, useMemo } from 'react'",
      "import { expensive, observe } from './expensive'",
      '',
      'export function Probe({ left, right }: { left: string; right: string }) {',
      '  const joined = useMemo(() => expensive(left, right), [left, right])',
      '  useEffect(() => observe(joined), [joined])',
      '  return <div />',
      '}',
    ]),
  )

  // The compiler picks the same keys here, so key matching alone would call it redundant.
  expect(rows[0]?.name).toBe('joined')
  expect(rows[0]?.verdict).toContain('a hook depends on this value')
})

test('never calls a memo redundant when the value is a ref callback', () => {
  const rows: readonly AuditRow[] = auditManualMemos(
    'probe.tsx',
    source([
      "import { useCallback, useState } from 'react'",
      '',
      'export function useProbe() {',
      '  const [, setNode] = useState<HTMLElement | null>(null)',
      '  const ref = useCallback((node: HTMLElement | null) => setNode(node), [])',
      '  return { ref }',
      '}',
    ]),
  )

  expect(rows[0]?.name).toBe('ref')
  expect(rows[0]?.verdict).toContain('a hook depends on this value')
})
