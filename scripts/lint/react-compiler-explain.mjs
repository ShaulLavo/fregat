import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { parseSync } from 'oxc-parser'

import { isTestFile } from './web-design-census.mjs'

const REPOSITORY = path.resolve(import.meta.dirname, '../..')
const DEFAULT_ROOTS = [
  'apps/web/src',
  'packages/markdown/src',
  'packages/tree/src',
  'packages/ui/src',
]
const MANUAL_MEMO_HOOKS = new Set(['useMemo', 'useCallback'])
const SUMMARY_WIDTH = 96

// The build's own compiler, for the reason the census gives: another version memoizes differently.
const { transformSync } = createRequire(path.join(REPOSITORY, 'apps/web/package.json'))(
  'oxc-transform-react',
)

function compile(file, source) {
  const result = transformSync(file, source, { jsx: { runtime: 'automatic' }, reactCompiler: {} })
  return { code: result.code, errors: result.errors }
}

function parse(file, code) {
  return parseSync(file, code).program
}

function children(node) {
  return Object.values(node)
    .flat()
    .filter((value) => value && typeof value === 'object' && typeof value.type === 'string')
}

function walk(node, visit) {
  if (visit(node) === false) return
  for (const child of children(node)) walk(child, visit)
}

function isFunction(node) {
  return (
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'FunctionExpression' ||
    node.type === 'FunctionDeclaration'
  )
}

function isCacheSlot(node) {
  return node.type === 'MemberExpression' && node.computed && node.object.name === '$'
}

/** A `$[n] !== dep` chain is a keyed block; a sentinel comparison is a compute-once block. */
function blockKeys(condition, code) {
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

function assignedNames(block) {
  const names = []
  walk(block, (node) => {
    if (isFunction(node)) return false
    if (node.type === 'AssignmentExpression' && node.left.type === 'Identifier')
      names.push(node.left.name)
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier')
      names.push(node.id.name)
  })
  return names
}

function summarize(block, code) {
  const text = block.body
    .map((statement) => code.slice(statement.start, statement.end).replace(/\s+/g, ' '))
    .filter((statement) => !statement.startsWith('$['))
    .join(' ')
  return text.length > SUMMARY_WIDTH ? `${text.slice(0, SUMMARY_WIDTH - 1)}…` : text
}

/** `const focusedDiff = t7` names what the temp `t7` was computed for. */
function temporaryAliases(body) {
  const aliases = new Map()
  walk(body, (node) => {
    const alias =
      node.type === 'VariableDeclarator' &&
      node.id.type === 'Identifier' &&
      node.init?.type === 'Identifier'
    if (alias) aliases.set(node.init.name, node.id.name)
  })
  return aliases
}

function memoBlocks(body, code) {
  const aliases = temporaryAliases(body)
  const blocks = []
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
function derivedTemporaries(body, code) {
  const derived = new Map()
  walk(body, (node) => {
    if (node.type !== 'VariableDeclarator' || node.id.type !== 'Identifier') return
    if (!/^t\d+$/.test(node.id.name) || !node.init || node.init.type === 'Identifier') return
    derived.set(node.id.name, code.slice(node.init.start, node.init.end).replace(/\s+/gu, ' '))
  })
  return derived
}

/** A key like `t10` is another block's output; what invalidates it is that block's own keys. */
function namedKeys(keys, blocks, derived, seen) {
  const resolved = keys.flatMap((key) => {
    if (!/^t\d+$/.test(key) || seen.has(key)) return [key]
    const producer = producerOf(key, blocks)
    const next = new Set([...seen, key])
    if (producer) return namedKeys(producer.keys, blocks, derived, next)
    return [derived.get(key) ?? key]
  })
  return [...new Set(resolved)]
}

function producerOf(temporary, blocks) {
  return blocks.find((block) => block.temporaries.includes(temporary))
}

function usesMemoCache(body, code) {
  return /\b_c\(\d+\)/.test(code.slice(body.start, body.end))
}

function collectFunctions(node, name, found) {
  if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration')
    return node.declaration ? collectFunctions(node.declaration, name, found) : undefined
  if (node.type === 'VariableDeclaration')
    return node.declarations.forEach((entry) => collectFunctions(entry, name, found))
  if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init)
    return collectFunctions(node.init, node.id.name, found)
  // `memo(() => …)` and `forwardRef(…)` wrap the component in a call.
  if (node.type === 'CallExpression')
    return node.arguments.forEach((argument) => collectFunctions(argument, name, found))
  if (!isFunction(node) || node.body.type !== 'BlockStatement') return undefined
  const resolved = node.id?.name ?? name
  if (resolved) found.push({ name: resolved, body: node.body })
  return undefined
}

function isReactFunction(name) {
  return /^[A-Z]/.test(name) || /^use[A-Z]/.test(name)
}

/** Every component and hook in a file: whether it compiled, and what each memo block is keyed on. */
export function explainSource(file, source) {
  const { code, errors } = compile(file, source)
  const found = []
  for (const statement of parse(file, code).body) collectFunctions(statement, null, found)
  const functions = found
    .filter((entry) => isReactFunction(entry.name))
    .map((entry) => {
      const compiled = usesMemoCache(entry.body, code)
      return { name: entry.name, compiled, blocks: compiled ? memoBlocks(entry.body, code) : [] }
    })
  return { file, functions, diagnostics: errors.map((error) => error.message) }
}

function manualMemoSites(tree) {
  const sites = []
  walk(tree, (node) => {
    const declared =
      node.type === 'VariableDeclarator' &&
      node.id.type === 'Identifier' &&
      node.init?.type === 'CallExpression' &&
      MANUAL_MEMO_HOOKS.has(node.init.callee.name)
    if (declared) sites.push({ name: node.id.name, call: node.init })
  })
  return sites
}

/** The same value with the manual memo taken away, so the compiler's own choice shows. */
function withoutManualMemo(site, source) {
  const [callback] = site.call.arguments
  if (!callback) return null
  const text = source.slice(callback.start, callback.end)
  if (site.call.callee.name === 'useCallback') return text
  if (!isFunction(callback)) return null
  if (callback.body.type === 'BlockStatement') return `(${text})()`
  return `(${source.slice(callback.body.start, callback.body.end)})`
}

function manualDeps(site, source) {
  const deps = site.call.arguments[1]
  if (deps?.type !== 'ArrayExpression') return null
  return deps.elements.map((element) => source.slice(element.start, element.end))
}

function keysFor(explained, name) {
  for (const entry of explained.functions) {
    const block = entry.blocks.find((candidate) => candidate.yields.includes(name))
    if (block) return block.keys
  }
  return null
}

function sameSet(left, right) {
  return left.length === right.length && left.every((value) => right.includes(value))
}

function verdict(manual, inferred, refusedWithout) {
  if (refusedWithout) return 'needed: the compiler refuses the component without it'
  if (inferred === null) return 'needed: the compiler does not memoize this value on its own'
  if (manual !== null && sameSet(manual, inferred))
    return 'redundant: the compiler picks the same keys'
  return 'differs: read both key lists and decide'
}

function lineOf(source, offset) {
  return source.slice(0, offset).split('\n').length
}

/** Compiles the file once per manual memo with that memo removed, and compares the keys. */
export function auditManualMemos(file, source) {
  const baseline = compile(file, source).errors.length
  return manualMemoSites(parse(file, source)).flatMap((site) => {
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
        verdict: verdict(manual, inferred, explained.diagnostics.length > baseline),
      },
    ]
  })
}

function sourceFiles(target) {
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

function relative(file) {
  return path.relative(REPOSITORY, file).split(path.sep).join('/')
}

function formatKeys(keys) {
  if (keys === null) return '(not memoized)'
  return keys.length === 0 ? '(computed once)' : keys.join(', ')
}

function formatExplained(explained, only) {
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

function formatAudit(rows) {
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
  const read = (file) => [relative(file), fs.readFileSync(file, 'utf8')]
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
      .filter((row) => !values.undecided || !row.verdict.startsWith('needed'))
    return print(values.json, rows, `${formatAudit(rows)}\n\n${tally(rows)}`)
  }
  process.stderr.write('usage: react-compiler-explain.mjs <explain|memos> [file-or-dir…]\n')
  process.exitCode = 2
}

function tally(rows) {
  const counts = new Map()
  for (const row of rows) {
    const kind = row.verdict.split(':')[0]
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return [...counts].map(([kind, count]) => `${kind} ${count}`).join(', ') || 'no manual memos'
}

function print(json, data, text) {
  process.stdout.write(json ? `${JSON.stringify(data, null, 2)}\n` : `${text}\n`)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main()
