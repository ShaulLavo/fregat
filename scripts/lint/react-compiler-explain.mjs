import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { createHash } from 'node:crypto'

import { parseSync } from 'oxc-parser'

import { compileLikeBuild } from './react-compiler.mjs'
import { isTestFile } from './web-design-census.mjs'

const REPOSITORY = path.resolve(import.meta.dirname, '../..')
const DEFAULT_REVIEWS = path.join(REPOSITORY, 'scripts/lint/react-memo-reviewed.json')
const DEFAULT_ROOTS = [
  'apps/web/src',
  'apps/tui/src',
  'packages/markdown/src',
  'packages/tree/src',
  'packages/ui/src',
]
const MANUAL_MEMO_HOOKS = new Set(['useMemo', 'useCallback'])
const SUMMARY_WIDTH = 96

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
    return left && right ? left.concat(right) : null
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
      yields: Array.from(new Set(names.map((name) => aliases.get(name) ?? name))),
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
    const next = new Set(seen)
    next.add(key)
    if (producer) return namedKeys(producer.keys, blocks, derived, next)
    return [derived.get(key) ?? key]
  })
  return Array.from(new Set(resolved))
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
  if (resolved) found.push({ name: resolved, body: node.body, params: node.params })
  return undefined
}

function isReactFunction(name) {
  return /^[A-Z]/.test(name) || /^use[A-Z]/.test(name)
}

/** Every component and hook in a file: whether it compiled, and what each memo block is keyed on. */
export function explainSource(file, source) {
  const { code, errors } = compileLikeBuild(file, source)
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

function rootIdentifier(node) {
  let cursor = node
  while (cursor && (cursor.type === 'MemberExpression' || cursor.type === 'ChainExpression'))
    cursor = cursor.expression ?? cursor.object
  return cursor?.type === 'Identifier' ? cursor.name : null
}

function referencedNames(tree) {
  const names = new Set()
  if (!tree) return names
  walk(tree, (node) => {
    if (node.type === 'Identifier') names.add(node.name)
    if (node.type === 'Property' && !node.computed) {
      for (const name of referencedNames(node.value)) names.add(name)
      return false
    }
    if (node.type === 'MemberExpression' && !node.computed) {
      for (const name of referencedNames(node.object)) names.add(name)
      return false
    }
  })
  return names
}

function reactImports(tree) {
  const imports = { named: new Map(), namespaces: new Set() }
  for (const statement of tree.body) {
    if (statement.type !== 'ImportDeclaration' || statement.source.value !== 'react') continue
    recordReactImports(statement.specifiers, imports)
  }
  return imports
}

function recordReactImports(specifiers, imports) {
  for (const specifier of specifiers) {
    if (specifier.type === 'ImportSpecifier') {
      imports.named.set(specifier.local.name, specifier.imported.name ?? specifier.imported.value)
      continue
    }
    imports.namespaces.add(specifier.local.name)
  }
}

function reactHook(callee, imports) {
  if (callee?.type === 'Identifier') return imports.named.get(callee.name) ?? null
  if (callee?.type !== 'MemberExpression' || !imports.namespaces.has(callee.object.name))
    return null
  const name = callee.computed ? callee.property.value : callee.property.name
  return typeof name === 'string' ? name : null
}

function bindingNames(pattern, names) {
  if (!pattern) return
  if (pattern.type === 'Identifier') {
    names.add(pattern.name)
    return
  }
  if (pattern.type === 'RestElement') return bindingNames(pattern.argument, names)
  if (pattern.type === 'AssignmentPattern') return bindingNames(pattern.left, names)
  if (pattern.type === 'ArrayPattern') {
    for (const element of pattern.elements) bindingNames(element, names)
    return
  }
  if (pattern.type === 'ObjectPattern')
    for (const property of pattern.properties)
      bindingNames(property.value ?? property.argument, names)
}

function scopedImports(entry, imports) {
  const shadowed = new Set()
  for (const parameter of entry.params) bindingNames(parameter, shadowed)
  walk(entry.body, (node) => {
    if (isFunction(node)) {
      bindingNames(node.id, shadowed)
      return false
    }
    if (node.type === 'VariableDeclarator') bindingNames(node.id, shadowed)
  })
  return {
    named: new Map(Array.from(imports.named).filter(([name]) => !shadowed.has(name))),
    namespaces: new Set(Array.from(imports.namespaces).filter((name) => !shadowed.has(name))),
  }
}

function addAliasReads(names, alias, reads) {
  if (!names.has(alias)) return false
  let changed = false
  for (const read of reads) {
    if (names.has(read)) continue
    names.add(read)
    changed = true
  }
  return changed
}

function expandAliases(tree, names) {
  const aliases = []
  walk(tree, (node) => {
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init)
      aliases.push([node.id.name, referencedNames(node.init)])
  })
  let changed
  do {
    changed = aliases.reduce(
      (changed, [alias, reads]) => addAliasReads(names, alias, reads) || changed,
      false,
    )
  } while (changed)
  return names
}

function dependencyNames(tree, imports) {
  const names = new Set()
  walk(tree, (node) => {
    if (node.type !== 'CallExpression') return
    const hook = reactHook(node.callee, imports) ?? node.callee?.name
    if (!hook?.startsWith('use')) return
    // Arguments carry dependencies, selectors, and options through arrays, objects, or closures.
    for (const argument of node.arguments) {
      for (const name of referencedNames(argument)) names.add(name)
    }
  })
  // React keys on a ref callback's identity too: it calls the old one with null on every change.
  walk(tree, (node) => {
    const attribute =
      node.type === 'JSXAttribute' && node.name?.name === 'ref' && node.value?.expression
    if (attribute) {
      const name = rootIdentifier(node.value.expression)
      if (name) names.add(name)
    }
    if (node.type !== 'Property' || node.key?.name !== 'ref') return
    const name = rootIdentifier(node.value)
    if (name) names.add(name)
  })
  return expandAliases(tree, names)
}

function manualMemoSites(tree, imports) {
  const sites = []
  walk(tree, (node) => {
    const declared =
      node.type === 'VariableDeclarator' &&
      node.id.type === 'Identifier' &&
      node.init?.type === 'CallExpression' &&
      MANUAL_MEMO_HOOKS.has(reactHook(node.init.callee, imports))
    if (declared)
      sites.push({
        name: node.id.name,
        hook: reactHook(node.init.callee, imports),
        call: node.init,
      })
  })
  return sites
}

/** The same value with the manual memo taken away, so the compiler's own choice shows. */
function withoutManualMemo(site, source) {
  const [callback] = site.call.arguments
  if (!callback) return null
  const text = source.slice(callback.start, callback.end)
  if (site.hook === 'useCallback') return text
  if (!isFunction(callback)) return null
  if (callback.body.type === 'BlockStatement') return `(${text})()`
  return `(${source.slice(callback.body.start, callback.body.end)})`
}

function manualDeps(site, source) {
  const deps = site.call.arguments[1]
  if (deps?.type !== 'ArrayExpression') return null
  if (deps.elements.some((element) => !element || element.type === 'SpreadElement')) return null
  return deps.elements.map((element) => source.slice(element.start, element.end))
}

function keysFor(explained, component, name) {
  const entry = explained.functions.find((entry) => entry.name === component)
  return entry?.blocks.find((candidate) => candidate.yields.includes(name))?.keys ?? null
}

function sameSet(left, right) {
  return left.length === right.length && left.every((value) => right.includes(value))
}

function escapingNames(tree, imports) {
  const names = new Set()
  const record = (node) => {
    for (const name of referencedNames(node)) names.add(name)
  }
  walk(tree, (node) => {
    if (
      node.type === 'ReturnStatement' &&
      !['JSXElement', 'JSXFragment'].includes(node.argument?.type)
    )
      record(node.argument)
    if (node.type === 'JSXElement') {
      const tag = node.openingElement.name
      if (tag.type === 'JSXIdentifier' && /^[a-z]/.test(tag.name)) return
      record(node)
    }
    if (node.type !== 'CallExpression' && node.type !== 'NewExpression') return
    const hook = reactHook(node.callee, imports) ?? node.callee?.name
    if (hook?.startsWith('use')) return
    if (node.callee.type === 'MemberExpression') record(node.callee.object)
    for (const argument of node.arguments) record(argument)
  })
  return expandAliases(tree, names)
}

function verdict(manual, inferred, refusedWithout, isDependency, escapes) {
  if (isDependency) return "needed: a hook depends on this value's identity"
  if (refusedWithout) return 'needed: the compiler refuses the component without it'
  if (inferred === null) return "review: the compiler output does not isolate this value's cache"
  if (manual !== null && sameSet(manual, inferred) && escapes)
    return 'review: the compiler picks the same keys, but a caller can depend on this value'
  if (manual !== null && sameSet(manual, inferred))
    return 'redundant: the compiler picks the same keys'
  return 'differs: read both key lists and decide'
}

function lineOf(source, offset) {
  return source.slice(0, offset).split('\n').length
}

function memoSignature(site, inferred, status) {
  const semantic = {
    hook: site.hook,
    status,
    arguments: site.call.arguments,
    typeArguments: site.call.typeArguments ?? site.call.typeParameters,
    inferred: inferred?.toSorted() ?? null,
  }
  const serialized = JSON.stringify(semantic, function (key, value) {
    if (['start', 'end', 'loc', 'range', 'comments'].includes(key)) return undefined
    if (key === 'raw' && this.type === 'Literal') return undefined
    if (typeof value === 'number' && !Number.isFinite(value)) return { number: String(value) }
    return typeof value === 'bigint' ? value.toString() : value
  })
  return createHash('sha256').update(serialized).digest('hex')
}

/** Compiles the file once per manual memo with that memo removed, and compares the keys. */
export function auditManualMemos(file, source) {
  const tree = parse(file, source)
  const imports = reactImports(tree)
  const functions = []
  for (const statement of tree.body) collectFunctions(statement, null, functions)
  const owned = functions
    .filter((entry) => isReactFunction(entry.name))
    .map((entry) => {
      const localImports = scopedImports(entry, imports)
      return { ...entry, imports: localImports, sites: manualMemoSites(entry.body, localImports) }
    })
  if (!owned.some((entry) => entry.sites.length > 0)) return []
  const baseline = compileLikeBuild(file, source).errors.length
  return owned.flatMap((entry) => {
    const dependencies = dependencyNames(entry.body, entry.imports)
    const escapes = escapingNames(entry.body, entry.imports)
    return entry.sites.flatMap((site) =>
      auditMemoSite(file, source, baseline, entry, dependencies, escapes, site),
    )
  })
}

function auditMemoSite(file, source, baseline, entry, dependencies, escapes, site) {
  const replacement = withoutManualMemo(site, source)
  if (replacement === null) return []
  const variant = source.slice(0, site.call.start) + replacement + source.slice(site.call.end)
  const explained = explainSource(file, variant)
  const manual = manualDeps(site, source)
  const inferred = keysFor(explained, entry.name, site.name)
  let comparison = 'unavailable'
  if (manual !== null && inferred !== null)
    comparison = sameSet(manual, inferred) ? 'same' : 'different'
  const decision = verdict(
    manual,
    inferred,
    explained.diagnostics.length > baseline,
    dependencies.has(site.name),
    escapes.has(site.name),
  )
  return [
    {
      file,
      component: entry.name,
      line: lineOf(source, site.call.start),
      name: site.name,
      hook: site.hook,
      manual,
      inferred,
      status: decision.split(':')[0],
      signature: memoSignature(site, inferred, decision.split(':')[0]),
      comparison,
      manualOnly: manual && inferred ? manual.filter((key) => !inferred.includes(key)) : [],
      compilerOnly: manual && inferred ? inferred.filter((key) => !manual.includes(key)) : [],
      verdict: decision,
    },
  ]
}

function memoKey(entry) {
  return JSON.stringify([entry.file, entry.component, entry.name])
}

function reviewProblems(entries) {
  if (!Array.isArray(entries)) return ['memo reviews must be an array']
  const problems = []
  const seen = new Set()
  entries.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      problems.push(`review[${index}] must be an object`)
      return
    }
    for (const field of ['file', 'component', 'name', 'reason']) {
      if (typeof entry[field] !== 'string' || entry[field].trim() === '')
        problems.push(`review[${index}] needs ${field}`)
    }
    if (typeof entry.signature !== 'string' || !/^[a-f0-9]{64}$/.test(entry.signature))
      problems.push(`review[${index}] needs a current memo signature`)
    const key = memoKey(entry)
    if (seen.has(key)) problems.push(`review[${index}] repeats ${entry.file} ${entry.name}`)
    seen.add(key)
  })
  return problems
}

export function applyMemoReviews(rows, entries) {
  const problems = reviewProblems(entries)
  const reviews = new Map(
    (problems.length === 0 ? entries : []).map((entry) => [memoKey(entry), entry]),
  )
  return {
    problems,
    rows: rows.map((row) => {
      const entry = reviews.get(memoKey(row))
      const review = reviewState(entry, row.signature)
      return {
        ...row,
        review,
        approved: review === 'approved',
        reason: entry?.reason ?? null,
      }
    }),
  }
}

function reviewState(entry, signature) {
  if (!entry) return 'unreviewed'
  return entry.signature === signature ? 'approved' : 'changed'
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
      ]
        .concat(
          row.review === 'approved' ? [`    approved: ${row.reason}`] : [],
          row.review === 'changed'
            ? ['    previous review expired: the memo or compiler keys changed']
            : [],
          row.comparison === 'different'
            ? [
                `    manual-only: ${row.manualOnly.join(', ') || '(none)'}`,
                `    compiler-only: ${row.compilerOnly.join(', ') || '(none)'}`,
              ]
            : [],
        )
        .join('\n'),
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
      check: { type: 'boolean', default: false },
      reviews: { type: 'string', default: DEFAULT_REVIEWS },
      all: { type: 'boolean', default: false },
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
    const entries = JSON.parse(fs.readFileSync(path.resolve(values.reviews), 'utf8'))
    const reviewed = applyMemoReviews(
      files.flatMap((file) => auditManualMemos(...read(file))),
      entries,
    )
    if (reviewed.problems.length > 0) {
      process.stderr.write(`${reviewed.problems.join('\n')}\n`)
      process.exitCode = 2
      return
    }
    const rows = reviewed.rows
      .filter((row) => values.all || !row.approved)
      .filter(
        (row) => !values.undecided || row.status !== 'needed' || row.comparison === 'different',
      )
    const shown =
      values.check && !values.json ? rows.filter((row) => row.status === 'redundant') : rows
    const approved = reviewed.rows.filter((row) => row.approved).length
    const summary = [tally(rows), approved ? `approved ${approved}` : ''].filter(Boolean).join(', ')
    print(values.json, shown, [formatAudit(shown), summary].filter(Boolean).join('\n\n'))
    if (values.check && rows.some((row) => row.status === 'redundant' && !row.approved)) {
      process.stderr.write('Manual memo check failed: redundant memoization remains.\n')
      process.exitCode = 1
    }
    return
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
  return Array.from(counts, ([kind, count]) => `${kind} ${count}`).join(', ') || 'no manual memos'
}

function print(json, data, text) {
  process.stdout.write(json ? `${JSON.stringify(data, null, 2)}\n` : `${text}\n`)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main()
