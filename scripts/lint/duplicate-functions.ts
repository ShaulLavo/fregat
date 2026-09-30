import type { Node, Function, ArrowFunctionExpression, FunctionBody } from 'oxc-parser'
import { isNode } from './ast.ts'
type FunctionNode = ArrowFunctionExpression | (Function & { body: FunctionBody })
type Candidate = { name: string; node: FunctionNode }
type Location = { file: string; line: number; name: string }
type AllowEntry = { name: string; files: string[]; reason: string }
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSync } from 'oxc-parser'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const TIMING = 'packages/utils/src/timing.ts'
const DEFAULT_ALLOW = 'scripts/lint/duplicate-functions-allow.json'
const EXCLUDED = /(?:\/tests?\/|\.(?:test|spec|browser|test-d)\.|\/generated\/|\/protocol\/)/

function structure(this: unknown, key: string, value: unknown) {
  if (
    key === 'typeAnnotation' &&
    isNode(this) &&
    ['TSAsExpression', 'TSTypeAssertion'].includes(this.type)
  )
    return value
  if (['start', 'end', 'raw', 'typeAnnotation', 'returnType', 'typeParameters'].includes(key))
    return undefined
  return typeof value === 'bigint' ? String(value) : value
}

function candidates(statement: Node): Candidate[] {
  const node = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
  if (node?.type === 'FunctionDeclaration' && node.body && node.id)
    return [{ name: node.id.name, node: { ...node, body: node.body } }]
  if (node?.type !== 'VariableDeclaration') return []
  return node.declarations.flatMap<Candidate>((declaration) => {
    if (declaration.id.type !== 'Identifier') return []
    const node = declaration.init
    if (node?.type === 'ArrowFunctionExpression') return [{ name: declaration.id.name, node }]
    if (node?.type === 'FunctionExpression' && node.body)
      return [{ name: declaration.id.name, node: { ...node, body: node.body } }]
    return []
  })
}

function fingerprint(node: FunctionNode, file: string, bindings: string[]) {
  const body =
    node.body.type === 'BlockStatement'
      ? node.body.body
      : [{ type: 'ReturnStatement', argument: node.body }]
  if (body.length === 0) return null
  // Constant policies and plain state accessors have no algorithm to share.
  if (
    body.length === 1 &&
    body[0].type === 'ReturnStatement' &&
    (body[0].argument?.type === 'Literal' || body[0].argument?.type === 'Identifier')
  )
    return null
  return JSON.stringify(
    {
      captures: capturedState(node, file, bindings),
      params: node.params,
      typeParameters: node.typeParameters ?? null,
      returnType: node.returnType ?? null,
      async: node.async,
      generator: 'generator' in node ? node.generator : false,
      body,
    },
    structure,
  )
}

function stateBindings(statements: Node[]) {
  return statements.flatMap((outer) => {
    const node = 'declaration' in outer ? outer.declaration : outer
    if (node?.type !== 'VariableDeclaration') return []
    return node.declarations.flatMap((entry) => {
      if (entry.id.type !== 'Identifier') return []
      if (
        node.kind === 'const' &&
        (!entry.init ||
          !['NewExpression', 'CallExpression', 'AwaitExpression'].includes(entry.init.type))
      )
        return []
      return [entry.id.name]
    })
  })
}

function capturedState(node: FunctionNode, file: string, bindings: string[]) {
  const names = new Set<string>()
  visit(node.body, (child) => {
    if (child.type === 'Identifier') names.add(child.name)
  })
  return bindings.filter((name) => names.has(name)).map((name) => `${file}:${name}`)
}

function location(file: string, source: string, node: Node, name: string) {
  return { file, line: source.slice(0, node.start).split('\n').length, name }
}

function visit(node: unknown, callback: (node: Node) => void) {
  if (!node || typeof node !== 'object') return
  if (isNode(node)) callback(node)
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => visit(child, callback))
    else if (value && typeof value === 'object') visit(value, callback)
  }
}

function clockFallback(node: Node, source: string) {
  if (!['LogicalExpression', 'ConditionalExpression'].includes(node.type)) return false
  const text = source.slice(node.start, node.end)
  return (
    /(?:globalThis\.)?performance\s*(?:\?\.|\.)\s*now\s*\(/.test(text) &&
    /Date\s*\.\s*now\s*\(/.test(text)
  )
}

export function inspectFunctions(sources: readonly { file: string; source: string }[]) {
  const groups = new Map<string, Location[]>()
  const fallbacks: Location[] = []
  const errors: string[] = []
  for (const { file, source } of sources) {
    const parsed = parseSync(file, source)
    errors.push(...parsed.errors.map((error) => `${file}: ${error.message}`))
    const bindings = stateBindings(parsed.program.body)
    for (const candidate of parsed.program.body.flatMap(candidates)) {
      const key = fingerprint(candidate.node, file, bindings)
      if (!key) continue
      const group = groups.get(key) ?? []
      group.push(location(file, source, candidate.node, candidate.name))
      groups.set(key, group)
    }
    if (file === TIMING) continue
    visit(parsed.program, (node) => {
      if (clockFallback(node, source))
        fallbacks.push(location(file, source, node, 'clock fallback'))
    })
  }
  const duplicates = [...groups.values()].filter((group) => group.length > 1)
  return { duplicates, fallbacks, errors }
}

function allowKey(name: string, files: readonly string[]) {
  return `${name} :: ${[...files].sort().join(', ')}`
}

function entryProblems(entry: unknown, index: number) {
  const label = `allow[${index}]`
  if (!entry || typeof entry !== 'object') return [`${label}: entry must be an object`]
  const name = 'name' in entry ? entry.name : undefined
  const files = 'files' in entry ? entry.files : undefined
  const reason = 'reason' in entry ? entry.reason : undefined
  const problems = []
  if (typeof name !== 'string' || name === '') problems.push(`${label}: missing "name"`)
  if (!Array.isArray(files) || files.length < 2 || !files.every((file) => typeof file === 'string'))
    problems.push(`${label}: "files" must list the two or more copies`)
  if (typeof reason !== 'string' || reason.trim() === '')
    problems.push(`${label} (${name ?? '?'}): an exception without a reason is itself a violation`)
  return problems
}

/**
 * Splits the groups an allow-list excuses from the ones it does not, and reports entries that
 * match nothing: an exception matching nothing is a claim about code that no longer exists.
 */
export function applyAllowList(duplicates: Location[][], entries: unknown) {
  const problems = Array.isArray(entries)
    ? entries.flatMap(entryProblems)
    : ['the allow-list must be a JSON array of { name, files, reason } entries']
  const valid = Array.isArray(entries)
    ? entries.filter((entry): entry is AllowEntry => entryProblems(entry, 0).length === 0)
    : []
  const seen = new Set(
    duplicates.map((group) =>
      allowKey(
        group[0].name,
        group.map((item) => item.file),
      ),
    ),
  )
  for (const entry of valid)
    if (!seen.has(allowKey(entry.name, entry.files)))
      problems.push(`${entry.name}: stale, those copies no longer match`)
  const allowed = new Set(valid.map((entry) => allowKey(entry.name, entry.files)))
  const offenders = duplicates.filter(
    (group) =>
      !allowed.has(
        allowKey(
          group[0].name,
          group.map((item) => item.file),
        ),
      ),
  )
  return { offenders, problems }
}

function sourceFiles(root: string) {
  return execFileSync(
    'git',
    [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
      'apps',
      'packages',
      'scripts',
    ],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
    .split('\0')
    .filter(
      (file: string) =>
        /\.[cm]?[jt]sx?$/.test(file) && !EXCLUDED.test(file) && existsSync(path.join(root, file)),
    )
    .map((file) => ({ file, source: readFileSync(path.join(root, file), 'utf8') }))
}

function readAllowList(file: string) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []
}

function main() {
  const sources = sourceFiles(ROOT)
  const result = inspectFunctions(sources)
  const allow = applyAllowList(result.duplicates, readAllowList(path.join(ROOT, DEFAULT_ALLOW)))
  for (const group of allow.offenders) {
    console.error(
      'Copied function:\n' +
        group.map((item) => `  ${item.file}:${item.line} ${item.name}`).join('\n'),
    )
  }
  for (const item of result.fallbacks)
    console.error(`${item.file}:${item.line}: import nowMs from @workspace/utils/timing`)
  for (const problem of allow.problems) console.error(`allow-list  ${problem}`)
  for (const error of result.errors) console.error(error)
  console.log(
    `${sources.length} files; ${allow.offenders.length} duplicate function groups; ${result.fallbacks.length} inline clock fallbacks; ${result.errors.length} parse errors`,
  )
  if (
    allow.offenders.length ||
    allow.problems.length ||
    result.fallbacks.length ||
    result.errors.length
  )
    process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
