#!/usr/bin/env bun

// E033: whole-document text is read only inside named extraction functions. Every reference to a
// materializer, however it is renamed or re-exported, must sit in a function the allowlist names.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const allowPath = path.join(scriptDir, 'full-text-boundary-allow.json')

const MATERIALIZERS = new Set(['materializeFullText', 'materializePieceTableFullText'])
const READ_RANGE = 'readRange'
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'test', 'tests', '__tests__'])

const compilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  types: [],
  skipLibCheck: true,
  noEmit: true,
  allowImportingTsExtensions: true,
}

if (process.argv.includes('--self-test')) selfTest()
else main()

function main() {
  const files = productionSourceFiles(path.join(repoRoot, 'packages'))
  const allow = JSON.parse(readFileSync(allowPath, 'utf8'))
  const program = ts.createProgram(files, compilerOptions)
  const result = checkFullTextBoundary({
    program,
    files,
    allow,
    root: repoRoot,
    targetRoot: path.join(repoRoot, 'packages'),
  })
  report(result)
}

export function checkFullTextBoundary({ program, files, allow, root, targetRoot }) {
  const checker = program.getTypeChecker()
  const unresolved = unresolvedWorkspaceImports(program, files, checker, root)
  const findings = []
  for (const file of files) {
    const sourceFile = program.getSourceFile(file)
    if (!sourceFile) continue
    visit(sourceFile, (node) => {
      const finding = inspect(node, checker, targetRoot)
      if (finding)
        findings.push({ ...finding, file: path.relative(root, file), line: lineOf(node) })
    })
  }

  const allowed = new Set(allow.map((entry) => `${entry.file}#${entry.function}`))
  const used = new Set()
  const violations = []
  for (const finding of findings) {
    const key = `${finding.file}#${finding.function}`
    if (finding.kind !== 'getter' && allowed.has(key)) {
      used.add(key)
      continue
    }
    violations.push(finding)
  }
  const stale = allow.filter((entry) => !used.has(`${entry.file}#${entry.function}`))
  const unexplained = allow.filter((entry) => !entry.reason || entry.reason.trim().length < 12)
  return { violations, stale, unexplained, unresolved }
}

// A package whose dist is missing resolves nothing, and every reference through it goes unseen.
function unresolvedWorkspaceImports(program, files, checker, root) {
  const unresolved = []
  for (const file of files) {
    const sourceFile = program.getSourceFile(file)
    if (!sourceFile) continue
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue
      const specifier = statement.moduleSpecifier
      if (!specifier || !ts.isStringLiteral(specifier)) continue
      if (!specifier.text.startsWith('@singapore-editor/')) continue
      if (checker.getSymbolAtLocation(specifier)) continue
      unresolved.push(`${path.relative(root, file)}: ${specifier.text}`)
    }
  }
  return unresolved
}

function inspect(node, checker, targetRoot) {
  if (isFullTextGetter(node)) {
    return { kind: 'getter', function: functionName(node) ?? enclosingName(node) ?? '<module>' }
  }
  if (isFullRangeRead(node, checker, targetRoot)) return extraction(node, 'full-range read')
  if (!ts.isIdentifier(node) || isDeclarationName(node)) return null
  if (!referencesMaterializer(node, checker, targetRoot)) return null

  return extraction(node, node.text)
}

function extraction(node, what) {
  const name = enclosingName(node)
  // Implementing the explicit API by delegating to another materializer is not a new read.
  if (name && MATERIALIZERS.has(name.split('.').at(-1))) return null
  return { kind: 'extraction', what, function: name ?? '<module>' }
}

function referencesMaterializer(node, checker, targetRoot) {
  let symbol = checker.getSymbolAtLocation(node)
  if (!symbol) return false
  if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
  return (symbol.declarations ?? []).some((declaration) =>
    isTargetDeclaration(declaration, MATERIALIZERS, targetRoot),
  )
}

function isFullRangeRead(node, checker, targetRoot) {
  if (!ts.isCallExpression(node)) return false
  const callee = node.expression
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== READ_RANGE) return false
  const [start, end] = node.arguments
  if (!start || !end || !ts.isNumericLiteral(start) || start.text !== '0') return false
  if (!isLengthExpression(end, checker)) return false

  const symbol = checker.getSymbolAtLocation(callee.name)
  return (symbol?.declarations ?? []).some((declaration) =>
    isTargetDeclaration(declaration, new Set([READ_RANGE]), targetRoot),
  )
}

// `x.length`, or a local that holds one: `const length = x.length` or `const { length } = x`.
function isLengthExpression(node, checker) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text === 'length'
  if (!ts.isIdentifier(node)) return false
  const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration
  if (!declaration) return false
  if (ts.isBindingElement(declaration)) {
    return (declaration.propertyName ?? declaration.name).getText() === 'length'
  }
  if (!ts.isVariableDeclaration(declaration) || !declaration.initializer) return false
  const initializer = declaration.initializer
  return ts.isPropertyAccessExpression(initializer) && initializer.name.text === 'length'
}

function isTargetDeclaration(declaration, names, targetRoot) {
  const name = declaration.name
  if (!name || !ts.isIdentifier(name) || !names.has(name.text)) return false
  return path.resolve(declaration.getSourceFile().fileName).startsWith(targetRoot + path.sep)
}

function isFullTextGetter(node) {
  if (ts.isGetAccessorDeclaration(node)) return propertyNameText(node.name) === 'fullText'
  if (!ts.isCallExpression(node)) return false
  const callee = node.expression
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'defineProperty') return false
  const key = node.arguments[1]
  return key !== undefined && ts.isStringLiteralLike(key) && key.text === 'fullText'
}

function isDeclarationName(node) {
  const parent = node.parent
  // Importing or re-exporting is not a read; each use of the binding is checked where it happens.
  if (parent && (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent))) return true
  if (!parent || !('name' in parent) || parent.name !== node) return false
  if (ts.isPropertyAccessExpression(parent) || ts.isQualifiedName(parent)) return false
  if (ts.isBindingElement(parent)) return parent.propertyName === undefined
  return true
}

function enclosingName(node) {
  for (let current = node.parent; current; current = current.parent) {
    const name = functionName(current)
    if (name) return name
  }
  return null
}

function functionName(node) {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text
  if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)) {
    return qualified(node.parent, propertyNameText(node.name))
  }
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return null

  const parent = node.parent
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text
  if (ts.isPropertyAssignment(parent)) return propertyNameText(parent.name)
  if (ts.isPropertyDeclaration(parent))
    return qualified(parent.parent, propertyNameText(parent.name))
  return null
}

function qualified(owner, name) {
  if (owner && ts.isClassLike(owner) && owner.name) return `${owner.name.text}.${name}`
  return name
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isPrivateIdentifier(name)) {
    return name.text
  }
  return '<computed>'
}

function visit(node, callback) {
  callback(node)
  ts.forEachChild(node, (child) => visit(child, callback))
}

function lineOf(node) {
  const sourceFile = node.getSourceFile()
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

function productionSourceFiles(packagesRoot) {
  const files = []
  for (const entry of readdirSync(packagesRoot)) {
    const source = path.join(packagesRoot, entry, 'src')
    if (existsDirectory(source)) collectSources(source, files)
  }
  return files.sort()
}

function collectSources(directory, files) {
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry)
    if (existsDirectory(full)) {
      if (!IGNORED_DIRECTORIES.has(entry)) collectSources(full, files)
      continue
    }
    if (isProductionSource(entry)) files.push(full)
  }
}

function isProductionSource(name) {
  if (!/\.tsx?$/.test(name) || name.endsWith('.d.ts')) return false
  return !/\.test\.tsx?$/.test(name)
}

function existsDirectory(candidate) {
  try {
    return statSync(candidate).isDirectory()
  } catch {
    return false
  }
}

function report({ violations, stale, unexplained, unresolved }) {
  if (unresolved.length > 0) {
    for (const entry of unresolved.slice(0, 10)) console.error(`unresolved import ${entry}`)
    console.error(
      'Build the workspace packages first (`bun run build`); unresolved imports hide references.',
    )
    process.exitCode = 1
    return
  }
  for (const violation of violations) {
    const what = violation.kind === 'getter' ? 'full-text getter' : violation.what
    console.error(`${violation.file}:${violation.line} ${what} in ${violation.function}`)
  }
  for (const entry of stale) console.error(`stale allowlist entry: ${entry.file}#${entry.function}`)
  for (const entry of unexplained) {
    console.error(`allowlist entry needs a reason: ${entry.file}#${entry.function}`)
  }
  if (violations.length + stale.length + unexplained.length === 0) {
    console.log('full-text boundary: ok')
    return
  }
  console.error(
    'Whole-document text may only be read inside a named function listed, with its reason, in scripts/full-text-boundary-allow.json.',
  )
  process.exitCode = 1
}

function selfTest() {
  const root = '/virtual'
  const targetRoot = '/virtual/packages'
  const sources = {
    '/virtual/packages/core/src/snapshot.ts': [
      'export type Snap = {',
      '  readonly length: number',
      '  readRange(start: number, end: number): string',
      '  materializeFullText(): string',
      '}',
      'export function materializePieceTableFullText(): string { return "" }',
    ].join('\n'),
    '/virtual/packages/plugin/src/uses.ts': [
      "import { materializePieceTableFullText as flatten, type Snap } from '../../core/src/snapshot'",
      'export function viaAlias() { return flatten() }',
      'export function renamedWrapper(source: Snap) {',
      '  const { materializeFullText: grab } = source',
      '  return grab()',
      '}',
      'export function boundWrapper(source: Snap) { return source.materializeFullText.bind(source) }',
      'export function allowedPayload(source: Snap) { return source.materializeFullText() }',
      'export function fullRange(source: Snap) { return source.readRange(0, source.length) }',
      'export function boundedRange(source: Snap) { return source.readRange(0, 10) }',
      'export function heldLength(source: Snap) { const length = source.length; return source.readRange(0, length) }',
      'export function destructuredLength(source: Snap) { const { length } = source; return source.readRange(0, length) }',
      'export class Holder { get fullText() { return "" } }',
      'export const delegate = { materializeFullText: (source: Snap) => source.materializeFullText() }',
    ].join('\n'),
  }
  const host = ts.createCompilerHost(compilerOptions)
  const readFile = host.readFile.bind(host)
  const fileExists = host.fileExists.bind(host)
  const getSourceFile = host.getSourceFile.bind(host)
  host.readFile = (file) => sources[file] ?? readFile(file)
  host.fileExists = (file) => file in sources || fileExists(file)
  host.directoryExists = (directory) =>
    Object.keys(sources).some((file) => file.startsWith(`${directory}/`)) ||
    ts.sys.directoryExists(directory)
  host.getSourceFile = (file, language) =>
    file in sources
      ? ts.createSourceFile(file, sources[file], language, true)
      : getSourceFile(file, language)

  const files = Object.keys(sources)
  const program = ts.createProgram(files, compilerOptions, host)
  const allow = [
    { file: 'packages/plugin/src/uses.ts', function: 'allowedPayload', reason: 'fixture payload' },
    { file: 'packages/plugin/src/uses.ts', function: 'gone', reason: 'fixture stale entry' },
  ]
  const result = checkFullTextBoundary({ program, files, allow, root, targetRoot })
  const flagged = result.violations.map((violation) => violation.function).sort()
  const expected = [
    'Holder.fullText',
    'boundWrapper',
    'destructuredLength',
    'fullRange',
    'heldLength',
    'renamedWrapper',
    'viaAlias',
  ]
  const stale = result.stale.map((entry) => entry.function)

  const failures = []
  if (JSON.stringify(flagged) !== JSON.stringify(expected)) {
    failures.push(`flagged ${JSON.stringify(flagged)}, expected ${JSON.stringify(expected)}`)
  }
  if (JSON.stringify(stale) !== JSON.stringify(['gone'])) {
    failures.push(`stale ${JSON.stringify(stale)}, expected ["gone"]`)
  }
  if (failures.length === 0) {
    console.log('full-text boundary self-test: ok')
    return
  }
  for (const failure of failures) console.error(`self-test: ${failure}`)
  process.exitCode = 1
}
