import type {
  Node,
  BlockStatement,
  CallExpression,
  Function,
  ArrowFunctionExpression,
} from 'oxc-parser'
import { isNode } from './ast.ts'
type FunctionNode = Function | ArrowFunctionExpression
type Identifier = Extract<Node, { type: 'Identifier' }>
type Block = { keys: string[]; temporaries: string[]; yields: string[]; summary: string }
type FoundFunction = { name: string; body: BlockStatement }
type Explained = {
  file: string
  functions: { name: string; compiled: boolean; blocks: Block[] }[]
  diagnostics: string[]
}
type MemoSite = { name: string; call: CallExpression & { callee: Identifier } }
type AuditRow = {
  file: string
  line: number
  name: string
  hook: string
  manual: string[] | null
  inferred: string[] | null
  verdict: string
}
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { parseSync } from 'oxc-parser'

import { compileLikeBuild } from './react-compiler.ts'
import { isTestFile } from './web-design-census.ts'

const REPOSITORY = path.resolve(import.meta.dirname, '../..')
const DEFAULT_ROOTS = [
  'apps/web/src',
  'packages/markdown/src',
  'packages/tree/src',
  'packages/ui/src',
]
const MANUAL_MEMO_HOOKS = new Set(['useMemo', 'useCallback'])
const DEPENDENCY_HOOKS = new Set([
  'useEffect',
  'useLayoutEffect',
  'useMemo',
  'useCallback',
  'useImperativeHandle',
])
const SUMMARY_WIDTH = 96

function parse(file: string, code: string) {
  return parseSync(file, code).program
}

function children(node: Node) {
  return Object.values(node).flat().filter(isNode)
}

function walk(node: Node, visit: (node: Node) => void | boolean) {
  if (visit(node) === false) return
  for (const child of children(node)) walk(child, visit)
}

function isFunction(node: Node): node is FunctionNode {
  return (
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'FunctionExpression' ||
    node.type === 'FunctionDeclaration'
  )
}

function isCacheSlot(node: Node) {
  return (
    node.type === 'MemberExpression' &&
    node.computed &&
    node.object.type === 'Identifier' &&
    node.object.name === '$'
  )
}

/** A `$[n] !== dep` chain is a keyed block; a sentinel comparison is a compute-once block. */
function blockKeys(condition: Node, code: string): string[] | null {
  if (condition.type === 'LogicalExpression' && condition.operator === '||') {
    const left = blockKeys(condition.left, code)
    const right = blockKeys(condition.right, code)
    return left && right ? [...left, ...right] : null
  }
  if (condition.type !== 'BinaryExpression' || !isCacheSlot(condition.left)) return null
  if (condition.operator === '===') return []
  if (condition.operator !== '!==') return null
  return [code.slice(condition.right.start, condition.right.end)]
}

function assignedNames(block: BlockStatement) {
  const names: string[] = []
  walk(block, (node) => {
    if (isFunction(node)) return false
    if (node.type === 'AssignmentExpression' && node.left.type === 'Identifier')
      names.push(node.left.name)
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier')
      names.push(node.id.name)
  })
  return names
}

function summarize(block: BlockStatement, code: string) {
  const text = block.body
    .map((statement) => code.slice(statement.start, statement.end).replace(/\s+/g, ' '))
    .filter((statement: string) => !statement.startsWith('$['))
    .join(' ')
  return text.length > SUMMARY_WIDTH ? `${text.slice(0, SUMMARY_WIDTH - 1)}…` : text
}

/** `const focusedDiff = t7` names what the temp `t7` was computed for. */
function temporaryAliases(body: BlockStatement) {
  const aliases = new Map<string, string>()
  walk(body, (node) => {
    if (
      node.type === 'VariableDeclarator' &&
      node.id.type === 'Identifier' &&
      node.init?.type === 'Identifier'
    )
      aliases.set(node.init.name, node.id.name)
  })
  return aliases
}

function memoBlocks(body: BlockStatement, code: string) {
  const aliases = temporaryAliases(body)
  const blocks: Block[] = []
  walk(body, (node) => {
    if (node.type !== 'IfStatement' || node.consequent.type !== 'BlockStatement') return
    const keys = blockKeys(node.test, code)
    if (!keys) return
    const names = assignedNames(node.consequent)
    blocks.push({
      keys,
      temporaries: names,
      yields: [...new Set(names.map((name) => aliases.get(name) ?? name))],
      summary: summarize(node.consequent, code),
    })
  })
  const derived = derivedTemporaries(body, code)
  return blocks.map((block) => ({
    ...block,
    keys: namedKeys(block.keys, blocks, derived, new Set()),
  }))
}

/** `const t6 = persistence?.plugin` — an unconditional read the compiler keys on directly. */
function derivedTemporaries(body: BlockStatement, code: string) {
  const derived = new Map<string, string>()
  walk(body, (node) => {
    if (node.type !== 'VariableDeclarator' || node.id.type !== 'Identifier') return
    if (!/^t\d+$/.test(node.id.name) || !node.init || node.init.type === 'Identifier') return
    derived.set(node.id.name, code.slice(node.init.start, node.init.end).replace(/\s+/gu, ' '))
  })
  return derived
}

/** A key like `t10` is another block's output; what invalidates it is that block's own keys. */
function namedKeys(
  keys: string[],
  blocks: Block[],
  derived: Map<string, string>,
  seen: Set<string>,
): string[] {
  const resolved = keys.flatMap((key: string) => {
    if (!/^t\d+$/.test(key) || seen.has(key)) return [key]
    const producer = producerOf(key, blocks)
    const next = new Set([...seen, key])
    if (producer) return namedKeys(producer.keys, blocks, derived, next)
    return [derived.get(key) ?? key]
  })
  return [...new Set(resolved)]
}

function producerOf(temporary: string, blocks: Block[]) {
  return blocks.find((block) => block.temporaries.includes(temporary))
}

function usesMemoCache(body: BlockStatement, code: string) {
  return /\b_c\(\d+\)/.test(code.slice(body.start, body.end))
}

function collectFunctions(node: Node, name: string | null, found: FoundFunction[]): void {
  if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration')
    return node.declaration ? collectFunctions(node.declaration, name, found) : undefined
  if (node.type === 'VariableDeclaration')
    return node.declarations.forEach((entry) => collectFunctions(entry, name, found))
  if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init)
    return collectFunctions(node.init, node.id.name, found)
  // `memo(() => …)` and `forwardRef(…)` wrap the component in a call.
  if (node.type === 'CallExpression')
    return node.arguments.forEach((argument) => collectFunctions(argument, name, found))
  if (!isFunction(node) || node.body?.type !== 'BlockStatement') return undefined
  const resolved = ('id' in node ? node.id?.name : null) ?? name
  if (resolved) found.push({ name: resolved, body: node.body })
  return undefined
}

function isReactFunction(name: string) {
  return /^[A-Z]/.test(name) || /^use[A-Z]/.test(name)
}

/** Every component and hook in a file: whether it compiled, and what each memo block is keyed on. */
export function explainSource(file: string, source: string) {
  const { code, errors } = compileLikeBuild(file, source)
  const found: FoundFunction[] = []
  for (const statement of parse(file, code).body) collectFunctions(statement, null, found)
  const functions = found
    .filter((entry) => isReactFunction(entry.name))
    .map((entry) => {
      const compiled = usesMemoCache(entry.body, code)
      return { name: entry.name, compiled, blocks: compiled ? memoBlocks(entry.body, code) : [] }
    })
  return { file, functions, diagnostics: errors.map((error) => error.message) }
}

function rootIdentifier(node: Node | null | undefined) {
  let cursor = node
  while (cursor && (cursor.type === 'MemberExpression' || cursor.type === 'ChainExpression'))
    cursor = cursor.type === 'ChainExpression' ? cursor.expression : cursor.object
  return cursor?.type === 'Identifier' ? cursor.name : null
}

/**
 * Every identifier a hook keys on: named in a dependency array, or handed to a hook as an argument
 * the way a store selector is. Such a value must keep its identity, and the compiler's cache is a
 * cache rather than a guarantee — when it recomputes, the effect re-runs or the store re-subscribes.
 * A manual memo is load-bearing there however well the inferred keys match.
 */
function dependencyNames(tree: Node) {
  const names = new Set<string>()
  walk(tree, (node) => {
    if (
      node.type !== 'CallExpression' ||
      node.callee.type !== 'Identifier' ||
      !node.callee.name.startsWith('use')
    )
      return
    if (DEPENDENCY_HOOKS.has(node.callee.name)) {
      const deps = node.arguments[1]
      for (const element of deps?.type === 'ArrayExpression' ? (deps.elements ?? []) : []) {
        const name = rootIdentifier(element)
        if (name) names.add(name)
      }
    }
    // An identifier argument is the store shape: `useStore(select)`, `useStore(source.subscribe)`.
    for (const argument of node.arguments) {
      const name = rootIdentifier(argument)
      if (name) names.add(name)
    }
  })
  // React keys on a ref callback's identity too: it calls the old one with null on every change.
  walk(tree, (node) => {
    if (
      node.type === 'JSXAttribute' &&
      node.name.name === 'ref' &&
      node.value?.type === 'JSXExpressionContainer'
    ) {
      const name = rootIdentifier(node.value.expression)
      if (name) names.add(name)
    }
    if (node.type !== 'Property' || node.key.type !== 'Identifier' || node.key.name !== 'ref')
      return
    const name = rootIdentifier(node.value)
    if (name) names.add(name)
  })
  return names
}

function manualMemoSites(tree: Node) {
  const sites: MemoSite[] = []
  walk(tree, (node) => {
    if (node.type !== 'VariableDeclarator' || node.id.type !== 'Identifier') return
    const call = node.init
    if (
      call?.type !== 'CallExpression' ||
      call.callee.type !== 'Identifier' ||
      !MANUAL_MEMO_HOOKS.has(call.callee.name)
    )
      return
    sites.push({ name: node.id.name, call: { ...call, callee: call.callee } })
  })
  return sites
}

/** The same value with the manual memo taken away, so the compiler's own choice shows. */
function withoutManualMemo(site: MemoSite, source: string) {
  const [callback] = site.call.arguments
  if (!callback) return null
  const text = source.slice(callback.start, callback.end)
  if (site.call.callee.name === 'useCallback') return text
  if (!isFunction(callback) || !callback.body) return null
  if (callback.body.type === 'BlockStatement') return `(${text})()`
  return `(${source.slice(callback.body.start, callback.body.end)})`
}

function manualDeps(site: MemoSite, source: string) {
  const deps = site.call.arguments[1]
  if (deps?.type !== 'ArrayExpression') return null
  return deps.elements.map((element) => (element ? source.slice(element.start, element.end) : ''))
}

function keysFor(explained: Explained, name: string) {
  for (const entry of explained.functions) {
    const block = entry.blocks.find((candidate) => candidate.yields.includes(name))
    if (block) return block.keys
  }
  return null
}

function sameSet(left: string[], right: string[]) {
  return left.length === right.length && left.every((value) => right.includes(value))
}

function verdict(
  manual: string[] | null,
  inferred: string[] | null,
  refusedWithout: boolean,
  isDependency: boolean,
) {
  if (isDependency)
    return 'needed: a hook depends on this value, and compiler memoization is a cache, not identity'
  if (refusedWithout) return 'needed: the compiler refuses the component without it'
  if (inferred === null) return 'needed: the compiler does not memoize this value on its own'
  if (manual !== null && sameSet(manual, inferred))
    return 'redundant: the compiler picks the same keys'
  return 'differs: read both key lists and decide'
}

function lineOf(source: string, offset: number) {
  return source.slice(0, offset).split('\n').length
}

/** Compiles the file once per manual memo with that memo removed, and compares the keys. */
export function auditManualMemos(file: string, source: string) {
  const baseline = compileLikeBuild(file, source).errors.length
  const tree = parse(file, source)
  const dependencies = dependencyNames(tree)
  return manualMemoSites(tree).flatMap((site) => {
    const replacement = withoutManualMemo(site, source)
    if (replacement === null) return []
    const variant = source.slice(0, site.call.start) + replacement + source.slice(site.call.end)
    const explained = explainSource(file, variant)
    const manual = manualDeps(site, source)
    const inferred = keysFor(explained, site.name)
    return [
      {
        file,
        line: lineOf(source, site.call.start),
        name: site.name,
        hook: site.call.callee.name,
        manual,
        inferred,
        verdict: verdict(
          manual,
          inferred,
          explained.diagnostics.length > baseline,
          dependencies.has(site.name),
        ),
      },
    ]
  })
}

function sourceFiles(target: string) {
  const absolute = path.resolve(REPOSITORY, target)
  if (fs.statSync(absolute).isFile()) return [absolute]
  return fs
    .readdirSync(absolute, { recursive: true, withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts'),
    )
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => !file.includes(`${path.sep}node_modules${path.sep}`) && !isTestFile(file))
    .sort()
}

function relative(file: string) {
  return path.relative(REPOSITORY, file).split(path.sep).join('/')
}

function formatKeys(keys: string[] | null) {
  if (keys === null) return '(not memoized)'
  return keys.length === 0 ? '(computed once)' : keys.join(', ')
}

function formatExplained(explained: Explained, only: string | undefined) {
  const lines = [explained.file]
  for (const message of explained.diagnostics) lines.push(`  refused: ${message}`)
  for (const entry of explained.functions) {
    if (only && entry.name !== only) continue
    lines.push(
      `  ${entry.name}: ${entry.compiled ? `${entry.blocks.length} memo blocks` : 'not memoized'}`,
    )
    for (const block of entry.blocks) {
      lines.push(`    [${formatKeys(block.keys)}] → ${block.yields.join(', ') || '(effects only)'}`)
      lines.push(`        ${block.summary}`)
    }
  }
  return lines.join('\n')
}

function formatAudit(rows: AuditRow[]) {
  return rows
    .map((row) =>
      [
        `${row.file}:${row.line}  ${row.name} (${row.hook})`,
        `    ${row.verdict}`,
        `    manual:   ${formatKeys(row.manual)}`,
        `    compiler: ${formatKeys(row.inferred)}`,
      ].join('\n'),
    )
    .join('\n')
}

function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      component: { type: 'string' },
      json: { type: 'boolean', default: false },
      // `memos` only: hide the rows that need no decision.
      undecided: { type: 'boolean', default: false },
    },
  })
  const [verb, ...targets] = positionals
  const files = (targets.length === 0 ? DEFAULT_ROOTS : targets).flatMap(sourceFiles)
  const read = (file: string): [string, string] => [relative(file), fs.readFileSync(file, 'utf8')]
  if (verb === 'explain') {
    const explained = files.map((file) => explainSource(...read(file)))
    const shown = explained.filter((entry) => entry.functions.length + entry.diagnostics.length > 0)
    return print(
      values.json,
      shown,
      shown.map((entry) => formatExplained(entry, values.component)).join('\n\n'),
    )
  }
  if (verb === 'memos') {
    const rows = files
      .flatMap((file) => auditManualMemos(...read(file)))
      .filter((row: { verdict: string }) => !values.undecided || !row.verdict.startsWith('needed'))
    return print(values.json, rows, `${formatAudit(rows)}\n\n${tally(rows)}`)
  }
  process.stderr.write('usage: react-compiler-explain.ts <explain|memos> [file-or-dir…]\n')
  process.exitCode = 2
}

function tally(rows: AuditRow[]) {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const kind = row.verdict.split(':')[0]
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return [...counts].map(([kind, count]) => `${kind} ${count}`).join(', ') || 'no manual memos'
}

function print(json: boolean, data: unknown, text: string) {
  process.stdout.write(json ? `${JSON.stringify(data, null, 2)}\n` : `${text}\n`)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main()
