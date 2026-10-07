import fs from 'node:fs'
import path from 'node:path'
import { SourceMap } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript-api'
import { expect, test } from 'vitest'
import { resolveConfig } from 'vite'
import {
  loadPhosphorCatalog,
  phosphorImportPlugin,
  rewritePhosphorImports,
} from './phosphor-import-plugin'

const catalog = loadPhosphorCatalog()
const rewrite = (code: string, id = '/src/view.tsx') => rewritePhosphorImports(code, id, catalog)

test('resolves actual icon aliases and library exports from the installed root', () => {
  expect(catalog.get('Gear')).toEqual({
    kind: 'named',
    imported: 'Gear',
    module: '@phosphor-icons/react/dist/csr/Gear',
  })
  expect(catalog.get('GearIcon')).toEqual({
    kind: 'named',
    imported: 'GearIcon',
    module: '@phosphor-icons/react/dist/csr/Gear',
  })
  expect(catalog.get('IconContext')?.module).toBe('@phosphor-icons/react/dist/lib/context')
  expect(catalog.get('IconBase')?.module).toBe('@phosphor-icons/react/dist/lib/IconBase')
  expect(catalog.size).toBeGreaterThan(3000)
  for (const target of catalog.values())
    expect(fs.existsSync(fileURLToPath(import.meta.resolve(target.module)))).toBe(true)
})

test('rewrites aliases and context while keeping type specifiers erased at runtime', () => {
  const out = rewrite(
    "import { Gear as Cog, GearIcon, IconContext as Theme, IconBase as Base, type IconProps } from '@phosphor-icons/react';\nconst value: IconProps = {}; ",
  )
  expect(out?.code).toContain("import {Gear as Cog} from '@phosphor-icons/react/dist/csr/Gear';")
  expect(out?.code).toContain(
    "import {IconContext as Theme} from '@phosphor-icons/react/dist/lib/context';",
  )
  expect(out?.code).toContain(
    "import {default as Base} from '@phosphor-icons/react/dist/lib/IconBase';",
  )
  expect(out?.code).toContain("import type {IconProps} from '@phosphor-icons/react';")
  expect(out?.code.endsWith('const value: IconProps = {}; ')).toBe(true)
})

test('rewrites named reexports with their exported aliases and type-only entries', () => {
  const out = rewrite(
    "export { GearIcon as Cog, IconBase as Base, type IconProps } from '@phosphor-icons/react';",
  )
  expect(out?.code).toBe(
    "export {GearIcon as Cog} from '@phosphor-icons/react/dist/csr/Gear';\nexport {default as Base} from '@phosphor-icons/react/dist/lib/IconBase';\nexport type {IconProps} from '@phosphor-icons/react';",
  )
})

test.each([
  "import type { IconProps } from '@phosphor-icons/react'",
  "export type { IconProps } from '@phosphor-icons/react'",
  "import {} from '@phosphor-icons/react'",
  "export {} from '@phosphor-icons/react'",
  "import Icons from '@phosphor-icons/react'",
  "import * as Icons from '@phosphor-icons/react'",
  "import '@phosphor-icons/react'",
  "export * from '@phosphor-icons/react'",
  "import { GearIcon, MissingExport } from '@phosphor-icons/react'",
  "const text = '@phosphor-icons/react'",
])('preserves intentional or unsupported declaration: %s', (code) => {
  expect(rewrite(code)).toBeNull()
})

test('keeps comments, directives and unmodified program text exact', () => {
  const before = "'use client';\n// icon import\n"
  const after = '\nconst emoji = "🎛️";\nexport const result = GearIcon;\n'
  const out = rewrite(before + "import { GearIcon } from '@phosphor-icons/react';" + after)
  expect(out?.code.startsWith(before)).toBe(true)
  expect(out?.code.endsWith(after)).toBe(true)
})

test('maps an unchanged statement after expanded imports to original UTF16 positions', () => {
  const code =
    "import { GearIcon, IconContext } from '@phosphor-icons/react';\r\nconst label = '🎛️';\r\nthrow label;"
  const out = rewrite(code, 'C:\\clone\\src\\view.tsx?version=1')
  expect(out).not.toBeNull()
  if (!out) return
  const generated = ts.createSourceFile('generated.tsx', out.code, ts.ScriptTarget.Latest)
  const original = ts.createSourceFile('original.tsx', code, ts.ScriptTarget.Latest)
  const point = generated.getLineAndCharacterOfPosition(out.code.indexOf('throw label'))
  const expected = original.getLineAndCharacterOfPosition(code.indexOf('throw label'))
  const entry = new SourceMap(out.map).findEntry(point.line, point.character)
  expect(entry.originalLine).toBe(expected.line)
  expect(entry.originalColumn).toBe(expected.character)
  expect(out.map.sources).toEqual(['view.tsx'])
  expect(out.map.sourcesContent).toEqual([code])
})

test('keeps Phosphor outside prebundling in DEV serve mode', async () => {
  const plugin = phosphorImportPlugin()
  expect(plugin.apply).toBe('serve')
  const config = await resolveConfig({ configFile: false, plugins: [plugin] }, 'serve')
  expect(config.optimizeDeps.exclude).toContain('@phosphor-icons/react')
})

function sourceFiles(root: string): string[] {
  const result: string[] = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) result.push(...sourceFiles(file))
    if (entry.isFile() && /\.tsx?$/.test(file)) result.push(file)
  }
  return result
}

test('all encountered app/shared runtime named imports and reexports exist in the installed catalog', () => {
  const roots = [
    path.resolve(import.meta.dirname, '../src'),
    path.resolve(import.meta.dirname, '../../../packages/ui/src'),
  ]
  const unknown: string[] = []
  for (const file of roots.flatMap(sourceFiles)) {
    const source = fs.readFileSync(file, 'utf8')
    if (!source.includes('@phosphor-icons/react')) continue
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
    unknown.push(...unknownImports(tree, file))
  }
  expect(unknown).toEqual([])
})

function unknownImports(tree: ts.SourceFile, file: string): string[] {
  const result: string[] = []
  for (const node of tree.statements) {
    const items = runtimeBindings(node)
    for (const item of items) {
      if (item.isTypeOnly) continue
      const name = (item.propertyName ?? item.name).text
      if (!catalog.has(name)) result.push(`${file}: ${name}`)
    }
  }
  return result
}

function runtimeBindings(node: ts.Statement): readonly (ts.ImportSpecifier | ts.ExportSpecifier)[] {
  if (ts.isImportDeclaration(node)) {
    if (
      !ts.isStringLiteral(node.moduleSpecifier) ||
      node.moduleSpecifier.text !== '@phosphor-icons/react'
    )
      return []
    const clause = node.importClause
    if (
      !clause ||
      clause.isTypeOnly ||
      !clause.namedBindings ||
      !ts.isNamedImports(clause.namedBindings)
    )
      return []
    return clause.namedBindings.elements
  }
  if (
    !ts.isExportDeclaration(node) ||
    node.isTypeOnly ||
    !node.moduleSpecifier ||
    !ts.isStringLiteral(node.moduleSpecifier)
  )
    return []
  if (
    node.moduleSpecifier.text !== '@phosphor-icons/react' ||
    !node.exportClause ||
    !ts.isNamedExports(node.exportClause)
  )
    return []
  return node.exportClause.elements
}
