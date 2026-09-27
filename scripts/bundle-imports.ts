import path from 'node:path'
import { parseSync, Visitor, type CallExpression, type Expression } from 'oxc-parser'
import { createScriptError } from './structured-errors'

/** Read emitted imports, including deps Vite preloads even when a different branch is chosen. */
export function bundleImports(fileName: string, source: string) {
  const { program, errors } = parseSync(fileName, source)
  if (errors.length) throw createScriptError(`Cannot parse built chunk ${fileName}`)
  const imports = new Set<string>()
  const dynamic = new Map<string, Set<string>>()
  const calls: CallExpression[] = []
  let mapping: string[] = []
  let inMapping = false
  const resolve = (name: string) => path.posix.join(path.posix.dirname(fileName), name)
  new Visitor({
    VariableDeclarator(node) {
      if (node.id.type === 'Identifier' && node.id.name === '__vite__mapDeps') inMapping = true
    },
    'VariableDeclarator:exit'(node) {
      if (node.id.type === 'Identifier' && node.id.name === '__vite__mapDeps') inMapping = false
    },
    ArrayExpression(node) {
      if (inMapping) mapping = node.elements.map((element) => literalString(element))
    },
    ImportDeclaration(node) {
      imports.add(resolve(node.source.value))
    },
    ExportNamedDeclaration(node) {
      if (node.source) imports.add(resolve(node.source.value))
    },
    ExportAllDeclaration(node) {
      imports.add(resolve(node.source.value))
    },
    CallExpression(node) {
      calls.push(node)
    },
    'CallExpression:exit'() {
      calls.pop()
    },
    ImportExpression(node) {
      const name = literalString(node.source)
      if (!name) return
      const target = resolve(name)
      const deps = dynamic.get(target) ?? new Set<string>()
      for (const call of calls) for (const dep of preloadDeps(call, mapping)) deps.add(dep)
      dynamic.set(target, deps)
    },
  }).visit(program)
  return { imports, dynamic }
}

function literalString(node: Expression | { type: string } | null | undefined): string {
  if (node?.type === 'Literal' && 'value' in node && typeof node.value === 'string')
    return node.value
  if (node?.type === 'TemplateLiteral' && 'expressions' in node && node.expressions.length === 0)
    return node.quasis[0]?.value.cooked ?? ''
  return ''
}

function preloadDeps(call: CallExpression, mapping: readonly string[]): readonly string[] {
  const argument = call.arguments[1]
  if (argument?.type === 'ArrayExpression')
    return argument.elements.map(literalString).filter(Boolean)
  if (
    argument?.type !== 'CallExpression' ||
    argument.callee.type !== 'Identifier' ||
    argument.callee.name !== '__vite__mapDeps'
  )
    return []
  const indices = argument.arguments[0]
  if (indices?.type !== 'ArrayExpression') throw createScriptError('Unknown Vite preload argument')
  return indices.elements.map((node) => {
    if (node?.type !== 'Literal' || typeof node.value !== 'number' || !mapping[node.value])
      throw createScriptError('Unknown Vite preload dependency')
    return mapping[node.value]!
  })
}
