import { expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// @ts-expect-error The tool is a plain ES module and the scripts workspace has no `allowJs`.
import { applyMemoReviews, auditManualMemos, explainSource } from './react-compiler-explain.mjs'

type Block = { readonly keys: readonly string[]; readonly yields: readonly string[] }
type Explained = {
  readonly functions: readonly {
    readonly name: string
    readonly compiled: boolean
    readonly blocks: readonly Block[]
  }[]
  readonly diagnostics: readonly string[]
}
type AuditRow = {
  readonly file: string
  readonly name: string
  readonly component: string
  readonly verdict: string
  readonly status: string
  readonly comparison: string
  readonly inferred: readonly string[] | null
  readonly manualOnly: readonly string[]
  readonly compilerOnly: readonly string[]
  readonly signature: string
}

type Reviewed = AuditRow & {
  readonly review: string
  readonly approved: boolean
}

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
  expect(rows[0]?.comparison).toBe('different')
  expect(rows[0]?.compilerOnly).toContain('item.label')
})

test.each([
  'useStore({ selector: selected })',
  'useStore((state) => selected(state))',
  'const options = { selector: selected }; useStore(options)',
])('retains a memo consumed through a hook argument: %s', (consumer) => {
  const rows: readonly AuditRow[] = auditManualMemos(
    'probe.tsx',
    source([
      "import { useMemo } from 'react'",
      "import { createSelector, useStore } from './store'",
      'export function Probe({ id }: { id: string }) {',
      '  const selected = useMemo(() => createSelector(id), [id])',
      `  ${consumer}`,
      '  return <div />',
      '}',
    ]),
  )

  expect(rows[0]?.status).toBe('needed')
})

test('reviews a callback returned in a tuple because its caller may use it as a ref', () => {
  const rows: readonly AuditRow[] = auditManualMemos(
    'probe.tsx',
    source([
      "import { useCallback, useState } from 'react'",
      'export function useProbe() {',
      '  const [node, setNode] = useState<HTMLElement | null>(null)',
      '  const ref = useCallback((element: HTMLElement | null) => setNode(element), [])',
      '  return [ref, node] as const',
      '}',
    ]),
  )

  expect(rows[0]?.comparison).toBe('same')
  expect(rows[0]?.status).toBe('review')
})

test('reviews a memo passed through an alias to another component', () => {
  const rows: readonly AuditRow[] = auditManualMemos(
    'probe.tsx',
    source([
      "import { useMemo } from 'react'",
      "import { expensive, Sink } from './expensive'",
      'export function Probe({ id }: { id: string }) {',
      '  const value = useMemo(() => expensive(id), [id])',
      '  const options = { value }',
      '  return <Sink options={options} />',
      '}',
    ]),
  )

  expect(rows[0]?.comparison).toBe('same')
  expect(rows[0]?.status).toBe('review')
})

test('keeps dependency consumers and compiler keys in the owning component', () => {
  const rows: readonly AuditRow[] = auditManualMemos(
    'probe.tsx',
    source([
      "import { useMemo, useEffect } from 'react'",
      "import { expensive, observe } from './expensive'",
      'export function First({ left }: { left: string }) {',
      '  const value = useMemo(() => expensive(left), [left])',
      '  useEffect(() => observe(value), [value])',
      '  return <div />',
      '}',
      'export function Second({ right }: { right: string }) {',
      '  const value = useMemo(() => expensive(right), [right])',
      '  return <div>{value}</div>',
      '}',
    ]),
  )

  expect(rows.map((row) => [row.component, row.status, row.inferred])).toEqual([
    ['First', 'needed', ['left']],
    ['Second', 'redundant', ['right']],
  ])
})

test.each([
  ["import { useMemo as cache } from 'react'", 'cache(() => expensive(id), [id])'],
  ["import * as React from 'react'", 'React.useMemo(() => expensive(id), [id])'],
])('recognizes imported React hook aliases: %s', (imported, expression) => {
  const rows: readonly AuditRow[] = auditManualMemos(
    'probe.tsx',
    source([
      imported,
      "import { expensive } from './expensive'",
      'export function Probe({ id }: { id: string }) {',
      `  const value = ${expression}`,
      '  return <div>{value}</div>',
      '}',
    ]),
  )

  expect(rows[0]?.status).toBe('redundant')
})

test('ignores an imported hook name shadowed by a parameter', () => {
  const rows: readonly AuditRow[] = auditManualMemos(
    'probe.tsx',
    source([
      "import { useMemo as cache } from 'react'",
      "import { expensive } from './expensive'",
      'export function Probe(cache: (fn: () => string, keys: string[]) => string) {',
      '  const value = cache(() => expensive(), [])',
      '  return <div>{value}</div>',
      '}',
    ]),
  )

  expect(rows).toEqual([])
})

test('check mode fails a redundant memo and leaves returned callbacks for review', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'fregat-memo-check-'))
  const file = path.join(directory, 'probe.tsx')
  const tool = fileURLToPath(new URL('./react-compiler-explain.mjs', import.meta.url))
  try {
    writeFileSync(
      file,
      source([
        "import { useMemo } from 'react'",
        "import { expensive } from './expensive'",
        'export function Probe({ id }: { id: string }) {',
        '  const value = useMemo(() => expensive(id), [id])',
        '  return <div>{value}</div>',
        '}',
      ]),
    )
    const redundant = spawnSync(process.execPath, [tool, 'memos', '--check', '--json', file], {
      encoding: 'utf8',
    })
    expect(redundant.status, redundant.stderr).toBe(1)
    expect(JSON.parse(redundant.stdout)[0]?.status).toBe('redundant')

    const reviews = path.join(directory, 'reviews.json')
    const memo: AuditRow = JSON.parse(redundant.stdout)[0]
    writeFileSync(reviews, JSON.stringify([{ ...memo, reason: 'Reviewed local consumers.' }]))
    const approved = spawnSync(
      process.execPath,
      [tool, 'memos', '--check', '--json', '--reviews', reviews, file],
      {
        encoding: 'utf8',
      },
    )
    expect(approved.status, approved.stderr).toBe(0)
    expect(JSON.parse(approved.stdout)).toEqual([])
    const all = spawnSync(
      process.execPath,
      [tool, 'memos', '--check', '--json', '--all', '--reviews', reviews, file],
      {
        encoding: 'utf8',
      },
    )
    expect(all.status, all.stderr).toBe(0)
    expect(JSON.parse(all.stdout)[0]?.approved).toBe(true)

    const changedSource = source([
      "import { useMemo } from 'react'",
      "import { expensive } from './expensive'",
      'export function Probe({ id }: { id: string }) {',
      '  const value = useMemo(() => expensive(id, 1), [id])',
      '  return <div>{value}</div>',
      '}',
    ])
    writeFileSync(file, changedSource)
    const expired = spawnSync(
      process.execPath,
      [tool, 'memos', '--check', '--json', '--reviews', reviews, file],
      {
        encoding: 'utf8',
      },
    )
    expect(expired.status, expired.stderr).toBe(1)
    expect(JSON.parse(expired.stdout)[0]?.review).toBe('changed')

    writeFileSync(
      file,
      source([
        "import { useCallback } from 'react'",
        'export function useProbe({ id }: { id: string }) {',
        '  const callback = useCallback(() => id, [id])',
        '  return [callback]',
        '}',
      ]),
    )
    const review = spawnSync(process.execPath, [tool, 'memos', '--check', '--json', file], {
      encoding: 'utf8',
    })
    expect(review.status, review.stderr).toBe(0)
    expect(JSON.parse(review.stdout)[0]?.status).toBe('review')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('memo review signatures survive formatting and expire on body or key changes', () => {
  const original = source([
    "import { useMemo } from 'react'",
    "import { expensive } from './expensive'",
    'export function Probe({ id, other }: { id: string; other: string }) {',
    '  const value = useMemo(() => expensive(id), [id])',
    '  return <div>{value}</div>',
    '}',
  ])
  const [memo]: readonly AuditRow[] = auditManualMemos('probe.tsx', original)
  const review = { ...memo, reason: 'Reviewed local reuse and retained intentionally.' }
  const inspect = (input: string): Reviewed =>
    applyMemoReviews(auditManualMemos('probe.tsx', input), [review]).rows[0]

  expect(inspect(original).approved).toBe(true)
  expect(inspect(original.replace('expensive(id)', 'expensive( id )')).approved).toBe(true)
  expect(inspect(original.replace('expensive(id)', 'expensive(/* note */ id)')).approved).toBe(true)
  expect(inspect(original.replace('expensive(id)', 'expensive(id, other)')).review).toBe('changed')
  expect(inspect(original.replace('[id]', '[id, other]')).review).toBe('changed')
})

test('memo review signatures retain whitespace inside string literals', () => {
  const original = source([
    "import { useMemo } from 'react'",
    "import { expensive } from './expensive'",
    'export function Probe({ id }: { id: string }) {',
    '  const value = useMemo(() => expensive(id, "hello world"), [id])',
    '  return <div>{value}</div>',
    '}',
  ])
  const [memo]: readonly AuditRow[] = auditManualMemos('probe.tsx', original)
  const review = { ...memo, reason: 'Reviewed the original string semantics.' }
  const changed: readonly AuditRow[] = auditManualMemos(
    'probe.tsx',
    original.replace('hello world', 'hello  world'),
  )
  expect(applyMemoReviews(changed, [review]).rows[0].approved).toBe(false)
})

test('memo review signatures distinguish non-finite numbers from null', () => {
  const original = source([
    "import { useMemo } from 'react'",
    'export function Probe() {',
    '  const value = useMemo(() => 1e400, [])',
    '  return <div>{value}</div>',
    '}',
  ])
  const [memo]: readonly AuditRow[] = auditManualMemos('probe.tsx', original)
  const review = { ...memo, reason: 'Reviewed the non-finite numeric value.' }
  const inspect = (literal: string): Reviewed =>
    applyMemoReviews(auditManualMemos('probe.tsx', original.replace('1e400', literal)), [review])
      .rows[0]

  expect(inspect('10e399').approved).toBe(true)
  expect(inspect('null').review).toBe('changed')
  expect(inspect('"Infinity"').review).toBe('changed')
})

test('memo reviews require reasons and reject duplicate entries', () => {
  const entry = {
    file: 'probe.tsx',
    component: 'Probe',
    name: 'value',
    signature: 'a'.repeat(64),
    reason: ' ',
  }
  expect(applyMemoReviews([], [entry]).problems).toContain('review[0] needs reason')
  const explained = { ...entry, reason: 'Reviewed consumers.' }
  expect(applyMemoReviews([], [explained, explained]).problems[0]).toContain('repeats')
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
