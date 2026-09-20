import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSync } from 'oxc-parser'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const TIMING = 'packages/utils/src/timing.ts'
const EXCLUDED = /(?:\/tests?\/|\.(?:test|spec|browser|test-d)\.|\/generated\/|\/protocol\/)/

function structure(key, value) {
  if (key === 'typeAnnotation' && ['TSAsExpression', 'TSTypeAssertion'].includes(this.type))
    return value
  if (['start', 'end', 'raw', 'typeAnnotation', 'returnType', 'typeParameters'].includes(key))
    return undefined
  return typeof value === 'bigint' ? String(value) : value
}

function candidates(statement) {
  const node = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
  if (node?.type === 'FunctionDeclaration' && node.body) return [{ name: node.id.name, node }]
  if (node?.type !== 'VariableDeclaration') return []
  return node.declarations.flatMap((declaration) => {
    if (declaration.id.type !== 'Identifier') return []
    if (!['ArrowFunctionExpression', 'FunctionExpression'].includes(declaration.init?.type))
      return []
    return [{ name: declaration.id.name, node: declaration.init }]
  })
}

function fingerprint(node, file, bindings) {
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
      generator: node.generator ?? false,
      body,
    },
    structure,
  )
}

function stateBindings(statements) {
  return statements.flatMap((outer) => {
    const node = outer.declaration ?? outer
    if (node.type !== 'VariableDeclaration') return []
    return node.declarations
      .filter(
        (entry) =>
          entry.id.type === 'Identifier' &&
          (node.kind !== 'const' ||
            ['NewExpression', 'CallExpression', 'AwaitExpression'].includes(entry.init?.type)),
      )
      .map((entry) => entry.id.name)
  })
}

function capturedState(node, file, bindings) {
  const names = new Set()
  visit(node.body, (child) => {
    if (child.type === 'Identifier') names.add(child.name)
  })
  return bindings.filter((name) => names.has(name)).map((name) => `${file}:${name}`)
}

function location(file, source, node, name) {
  return { file, line: source.slice(0, node.start).split('\n').length, name }
}

function visit(node, callback) {
  if (!node || typeof node !== 'object') return
  callback(node)
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => visit(child, callback))
    else if (value && typeof value === 'object') visit(value, callback)
  }
}

function clockFallback(node, source) {
  if (!['LogicalExpression', 'ConditionalExpression'].includes(node.type)) return false
  const text = source.slice(node.start, node.end)
  return (
    /(?:globalThis\.)?performance\s*(?:\?\.|\.)\s*now\s*\(/.test(text) &&
    /Date\s*\.\s*now\s*\(/.test(text)
  )
}

export function inspectFunctions(sources) {
  const groups = new Map()
  const fallbacks = []
  const errors = []
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
  return { duplicates: [...groups.values()].filter((group) => group.length > 1), fallbacks, errors }
}

function sourceFiles(root) {
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
      (file) =>
        /\.[cm]?[jt]sx?$/.test(file) && !EXCLUDED.test(file) && existsSync(path.join(root, file)),
    )
    .map((file) => ({ file, source: readFileSync(path.join(root, file), 'utf8') }))
}

function main() {
  const sources = sourceFiles(ROOT)
  const result = inspectFunctions(sources)
  for (const group of result.duplicates) {
    console.error(
      'Copied function:\n' +
        group.map((item) => `  ${item.file}:${item.line} ${item.name}`).join('\n'),
    )
  }
  for (const item of result.fallbacks)
    console.error(`${item.file}:${item.line}: import nowMs from @workspace/utils/timing`)
  for (const error of result.errors) console.error(error)
  console.log(
    `${sources.length} files; ${result.duplicates.length} duplicate function groups; ${result.fallbacks.length} inline clock fallbacks; ${result.errors.length} parse errors`,
  )
  if (result.duplicates.length || result.fallbacks.length || result.errors.length)
    process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
