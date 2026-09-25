import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, truncateSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript-language-service'
import { createWorkspacePaths } from '../../fs/path'
import { workerCompilerOptions, workerSupportFiles } from '../typescript/worker-program'

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const root = mkdtempSync('/work/tmp/l7-worker-boundary-')
  roots.push(root)
  return root
}
describe('worker project boundaries', () => {
  it('virtualizes config and paths bases for aliases and explicit ambient types', () => {
    const root = fixture()
    const config = path.join(root, 'repo', 'tsconfig.app.json')
    const options: ts.CompilerOptions = {
      paths: { '@/*': ['src/*'] },
      pathsBasePath: path.dirname(config),
      configFilePath: config,
      types: ['foo'],
    }
    expect(workerCompilerOptions(createWorkspacePaths(root), options)).toMatchObject({
      pathsBasePath: '/repo',
      configFilePath: '/repo/tsconfig.app.json',
      preserveSymlinks: false,
    })
  })
  it('refuses excessive source bytes before reading their contents', () => {
    const root = fixture()
    const file = path.join(root, 'a.ts')
    writeFileSync(file, 'small')
    truncateSync(file, 268_435_457)
    const read = vi.spyOn(ts.sys, 'readFile').mockReturnValue('small')
    expect(() =>
      workerSupportFiles({ options: {} } as ts.ParsedCommandLine, [file], root),
    ).toThrow()
    expect(read).not.toHaveBeenCalled()
  })
  it('does not read source content outside the authorized filesystem root', () => {
    const root = fixture()
    const outside = fixture()
    const file = path.join(outside, 'outside.ts')
    writeFileSync(file, 'export const secret = 1')
    const read = vi.spyOn(ts.sys, 'readFile')
    expect(workerSupportFiles({ options: {} } as ts.ParsedCommandLine, [file], root)).toEqual([])
    expect(read).not.toHaveBeenCalled()
  })
})
