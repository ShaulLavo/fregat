import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import ts from 'typescript-api'
import type { Plugin } from 'vite'
import { createScriptError } from '../../../scripts/structured-errors.ts'

const PACKAGE = '@phosphor-icons/react'
const SOURCE = /\.[cm]?[jt]sx?$/
const DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

type Target =
  | { readonly kind: 'named'; readonly module: string; readonly imported: string }
  | { readonly kind: 'default'; readonly module: string }
  | { readonly kind: 'namespace'; readonly module: string }
export type PhosphorCatalog = ReadonlyMap<string, Target>
type Edit = { readonly start: number; readonly end: number; readonly text: string }
type MapState = {
  lines: string[][]
  line: string[]
  column: number
  previousColumn: number
  originalLine: number
  originalColumn: number
}

function targetFor(module: string, imported: string | null): Target | null {
  const csr = /^\.\/csr\/([^/]+)\.es\.js$/.exec(module)
  if (csr && imported) return { kind: 'named', module: `${PACKAGE}/dist/csr/${csr[1]}`, imported }
  const lib = /^\.\/lib\/([^/]+)\.es\.js$/.exec(module)
  if (lib && imported) return { kind: 'named', module: `${PACKAGE}/dist/lib/${lib[1]}`, imported }
  if (lib) return { kind: 'default', module: `${PACKAGE}/dist/lib/${lib[1]}` }
  if (module === './ssr/index.es.js') return { kind: 'namespace', module: `${PACKAGE}/ssr` }
  return null
}

function importedTargets(tree: ts.SourceFile): ReadonlyMap<string, Target> {
  const targets = new Map<string, Target>()
  for (const node of tree.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue
    const clause = node.importClause
    if (!clause) continue
    if (clause.name) {
      const target = targetFor(node.moduleSpecifier.text, null)
      if (target) targets.set(clause.name.text, target)
    }
    if (clause.namedBindings) addBindings(targets, clause.namedBindings, node.moduleSpecifier.text)
  }
  return targets
}

function addBindings(
  targets: Map<string, Target>,
  bindings: ts.NamedImportBindings,
  module: string,
) {
  if (ts.isNamespaceImport(bindings)) {
    const target = targetFor(module, null)
    if (target) targets.set(bindings.name.text, target)
    return
  }
  for (const item of bindings.elements) {
    const target = targetFor(module, (item.propertyName ?? item.name).text)
    if (target) targets.set(item.name.text, target)
  }
}

export function loadPhosphorCatalog(): PhosphorCatalog {
  const require = createRequire(import.meta.url)
  const root = path.dirname(require.resolve(`${PACKAGE}/package.json`))
  const manifest: unknown = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  if (typeof manifest !== 'object' || manifest === null || !('exports' in manifest))
    throw createScriptError('Phosphor public exports are unavailable', {
      internal: { manifestType: typeof manifest },
    })
  const exports = manifest.exports
  if (typeof exports !== 'object' || exports === null)
    throw createScriptError('Phosphor public exports require an export map', {
      internal: { exportType: typeof exports },
    })
  const required = ['./dist/csr/*', './dist/lib/*', './ssr']
  const missing = required.filter((key) => !(key in exports))
  if (missing.length)
    throw createScriptError('Phosphor public icon and library entries are unavailable', {
      internal: { missingEntryCount: missing.length },
    })
  const file = path.join(root, 'dist/index.es.js')
  const tree = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  )
  const imports = importedTargets(tree)
  const catalog = new Map<string, Target>()
  for (const node of tree.statements) {
    if (
      !ts.isExportDeclaration(node) ||
      !node.exportClause ||
      !ts.isNamedExports(node.exportClause)
    )
      continue
    for (const item of node.exportClause.elements) {
      const target = imports.get((item.propertyName ?? item.name).text)
      if (target) catalog.set(item.name.text, target)
    }
  }
  return catalog
}

function specifierText(
  item: ts.ImportSpecifier | ts.ExportSpecifier,
  tree: ts.SourceFile,
  catalog: PhosphorCatalog,
  operation: 'import' | 'export',
): string | null {
  if (item.isTypeOnly)
    return `${operation} type {${item.getText(tree).replace(/^type\s+/, '')}} from '${PACKAGE}';`
  const target = catalog.get((item.propertyName ?? item.name).text)
  if (!target) return null
  const local = item.name.getText(tree)
  if (target.kind === 'namespace') return `${operation} * as ${local} from '${target.module}';`
  if (target.kind === 'default') {
    if (operation === 'import') return `import ${local} from '${target.module}';`
    return `export {default as ${local}} from '${target.module}';`
  }
  const binding = target.imported === local ? local : `${target.imported} as ${local}`
  return `${operation} {${binding}} from '${target.module}';`
}

function declarationEdit(
  node: ts.Statement,
  tree: ts.SourceFile,
  catalog: PhosphorCatalog,
): Edit | null {
  if (ts.isImportDeclaration(node)) {
    if (!ts.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== PACKAGE)
      return null
    const clause = node.importClause
    if (
      !clause ||
      clause.isTypeOnly ||
      clause.name ||
      !clause.namedBindings ||
      !ts.isNamedImports(clause.namedBindings)
    )
      return null
    return bindingEdit(node, clause.namedBindings.elements, tree, catalog, 'import')
  }
  if (
    !ts.isExportDeclaration(node) ||
    node.isTypeOnly ||
    !node.moduleSpecifier ||
    !ts.isStringLiteral(node.moduleSpecifier)
  )
    return null
  if (
    node.moduleSpecifier.text !== PACKAGE ||
    !node.exportClause ||
    !ts.isNamedExports(node.exportClause)
  )
    return null
  return bindingEdit(node, node.exportClause.elements, tree, catalog, 'export')
}

function bindingEdit(
  node: ts.Statement,
  items: readonly (ts.ImportSpecifier | ts.ExportSpecifier)[],
  tree: ts.SourceFile,
  catalog: PhosphorCatalog,
  operation: 'import' | 'export',
): Edit | null {
  if (!items.length) return null
  const parts = items.map((item) => specifierText(item, tree, catalog, operation))
  if (parts.some((part) => part === null)) return null
  return { start: node.getStart(tree), end: node.end, text: parts.join('\n') }
}

function vlq(value: number): string {
  let remaining = value < 0 ? -value * 2 + 1 : value * 2
  let encoded = ''
  do {
    const digit = remaining % 32
    remaining = Math.floor(remaining / 32)
    encoded += DIGITS.charAt(digit + (remaining ? 32 : 0))
  } while (remaining)
  return encoded
}

function mapPiece(
  state: MapState,
  tree: ts.SourceFile,
  text: string,
  origin: number,
  identity: boolean,
) {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') {
      state.line = []
      state.lines.push(state.line)
      state.column = 0
      state.previousColumn = 0
      continue
    }
    const original = tree.getLineAndCharacterOfPosition(origin + (identity ? index : 0))
    const segment =
      vlq(state.column - state.previousColumn) +
      'A' +
      vlq(original.line - state.originalLine) +
      vlq(original.character - state.originalColumn)
    state.line.push(segment)
    state.previousColumn = state.column
    state.originalLine = original.line
    state.originalColumn = original.character
    state.column += 1
  }
}

export function rewritePhosphorImports(code: string, id: string, catalog: PhosphorCatalog) {
  const clean = id.split('?')[0] ?? ''
  if (!SOURCE.test(clean) || !code.includes(PACKAGE)) return null
  const tree = ts.createSourceFile(
    clean,
    code,
    ts.ScriptTarget.Latest,
    true,
    clean.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const edits = tree.statements
    .map((node) => declarationEdit(node, tree, catalog))
    .filter((edit) => edit !== null)
  if (!edits.length) return null
  const line: string[] = []
  const state: MapState = {
    lines: [line],
    line,
    column: 0,
    previousColumn: 0,
    originalLine: 0,
    originalColumn: 0,
  }
  const parts: string[] = []
  let cursor = 0
  for (const edit of edits) {
    const before = code.slice(cursor, edit.start)
    parts.push(before, edit.text)
    mapPiece(state, tree, before, cursor, true)
    mapPiece(state, tree, edit.text, edit.start, false)
    cursor = edit.end
  }
  const after = code.slice(cursor)
  parts.push(after)
  mapPiece(state, tree, after, cursor, true)
  const file = clean.replaceAll('\\', '/').split('/').at(-1) ?? 'source.tsx'
  return {
    code: parts.join(''),
    map: {
      version: 3,
      file,
      sources: [file],
      sourcesContent: [code],
      names: [],
      mappings: state.lines.map((line) => line.join(',')).join(';'),
    },
  }
}

export function phosphorImportPlugin(): Plugin {
  const catalog = loadPhosphorCatalog()
  const transform = (code: string, id: string) => rewritePhosphorImports(code, id, catalog)
  return {
    name: 'fregat-phosphor-imports',
    apply: 'serve',
    enforce: 'pre',
    config() {
      return {
        optimizeDeps: {
          exclude: [PACKAGE],
          rolldownOptions: { plugins: [{ name: 'fregat-phosphor-import-scan', transform }] },
        },
      }
    },
    transform,
  }
}
