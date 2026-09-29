import { expect, it } from 'vitest'
import ts from 'typescript'
import { ProjectHost } from '../src/worker/projectHost'

it('renames one symbol through its package alias and canonical source', () => {
  const files = new Map([
    ['/repo/src/lib.ts', 'export const value = 1'],
    ['/repo/node_modules/pkg/index.ts', 'export const value = 1'],
    ['/repo/node_modules/pkg/package.json', '{"types":"index.ts"}'],
    ['/repo/main.ts', 'import { value } from "pkg"; value'],
  ])
  const project = new ProjectHost(
    files,
    ['/repo/src/lib.ts', '/repo/main.ts'],
    { noLib: true, moduleResolution: ts.ModuleResolutionKind.Node10 },
    { '/repo/node_modules/pkg/index.ts': '/repo/src/lib.ts' },
  )
  const locations = project.languageService.findRenameLocations(
    '/repo/src/lib.ts',
    13,
    false,
    false,
  )
  expect(locations?.map((location) => location.fileName)).toEqual([
    '/repo/src/lib.ts',
    '/repo/main.ts',
    '/repo/main.ts',
  ])
})

const canonical = '/repo/src/lib.ts'
const alias = '/repo/node_modules/pkg/index.ts'
function aliasProject() {
  return new ProjectHost(
    new Map([
      [canonical, 'export const value = 1'],
      [alias, 'export const value = 1'],
      ['/repo/node_modules/pkg/package.json', '{"types":"index.ts"}'],
      ['/repo/main.ts', 'import { value } from "./src/lib"; const n: number = value'],
    ]),
    ['/repo/main.ts'],
    { noLib: true, moduleResolution: ts.ModuleResolutionKind.Node10 },
    { [alias]: canonical },
  )
}

it.each([canonical, alias])('retains the other open alias when %s closes', (closed) => {
  const project = aliasProject()
  project.setOpen(canonical, 'export const value: string = "dirty"', 'canonical-editor')
  project.setOpen(alias, 'export const value: string = "dirty"', 'alias-editor')
  expect(
    project.languageService.getSemanticDiagnostics('/repo/main.ts').map((item) => item.code),
  ).toContain(2322)
  project.closeOpen(closed, closed === canonical ? 'canonical-editor' : 'alias-editor')
  expect(
    project.languageService.getSemanticDiagnostics('/repo/main.ts').map((item) => item.code),
  ).toContain(2322)
  project.closeOpen(
    closed === canonical ? alias : canonical,
    closed === canonical ? 'alias-editor' : 'canonical-editor',
  )
  expect(
    project.languageService.getSemanticDiagnostics('/repo/main.ts').map((item) => item.code),
  ).not.toContain(2322)
  project.languageService.dispose()
})

it('removes an alias after program creation without deleting its surviving canonical source', () => {
  const project = aliasProject()
  expect(project.languageService.getSemanticDiagnostics('/repo/main.ts')).toHaveLength(0)
  project.deleteFile(alias)
  expect(project.languageService.getSemanticDiagnostics('/repo/main.ts')).toHaveLength(0)
  expect(project.getSourceFile(canonical)?.text).toBe('export const value = 1')
  project.languageService.dispose()
})

it('stops resolving a deleted canonical source while its alias survives', () => {
  const project = aliasProject()
  expect(project.languageService.getSemanticDiagnostics('/repo/main.ts')).toHaveLength(0)
  project.deleteFile(canonical)
  expect(
    project.languageService.getSemanticDiagnostics('/repo/main.ts').map((item) => item.code),
  ).toContain(2307)
  project.setFile(canonical, 'export const value = 1')
  expect(project.languageService.getSemanticDiagnostics('/repo/main.ts')).toHaveLength(0)
  project.languageService.dispose()
})

it('invalidates cached package imports when their logical alias disappears', () => {
  const project = aliasProject()
  project.setFile('/repo/aliased.ts', 'import { value } from "pkg"; value')
  project.setRoots(['/repo/main.ts', '/repo/aliased.ts'])
  expect(project.languageService.getSemanticDiagnostics('/repo/aliased.ts')).toHaveLength(0)
  project.deleteFile(alias)
  expect(
    project.languageService.getSemanticDiagnostics('/repo/aliased.ts').map((item) => item.code),
  ).toContain(2307)
  expect(project.languageService.getSemanticDiagnostics('/repo/main.ts')).toHaveLength(0)
  project.setFile(alias, 'export const value = 1')
  expect(project.languageService.getSemanticDiagnostics('/repo/aliased.ts')).toHaveLength(0)
  project.languageService.dispose()
})
