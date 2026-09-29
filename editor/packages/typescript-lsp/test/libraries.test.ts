import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { BUNDLED_LIBRARY_FILES } from '../src/worker/bundledLibraries'
import { libraryFileName, loadLibraryFiles } from '../src/worker/libraries'
import { libraryFilesFromDisk, typeScriptLibraryFilesFromDisk } from './realTypeScriptService'

describe('standard library files', () => {
  it('bundles exactly the installed TypeScript library set', () => {
    const installed = Array.from(typeScriptLibraryFilesFromDisk().keys(), (path) => path.slice(1))

    expect(Object.keys(BUNDLED_LIBRARY_FILES).toSorted()).toEqual(installed.toSorted())
  })

  it('names a library the way a tsconfig may spell it', () => {
    expect(libraryFileName('ES2024')).toBe('lib.es2024.d.ts')
    expect(libraryFileName('lib.dom.iterable.d.ts')).toBe('lib.dom.iterable.d.ts')
    expect(libraryFileName('es6')).toBe('lib.es2015.d.ts')
  })

  it('loads the reference closure of the default library and nothing else', async () => {
    const rounds: string[][] = []
    const files = await loadLibraryFiles({ target: ts.ScriptTarget.ES2023 }, (names) => {
      rounds.push([...names])
      return Promise.resolve(libraryFilesFromDisk(names))
    })

    expect(rounds[0]).toEqual(['lib.es2023.full.d.ts'])
    expect(files.has('/lib.es5.d.ts')).toBe(true)
    expect(files.has('/lib.dom.d.ts')).toBe(true)
    expect(files.has('/lib.esnext.d.ts')).toBe(false)
    expect(files.size).toBeLessThan(typeScriptLibraryFilesFromDisk().size)
  })

  it('loads a bundled library through its lazy import', async () => {
    const load = BUNDLED_LIBRARY_FILES['lib.es5.d.ts']
    if (!load) throw new Error('lib.es5.d.ts is not bundled')

    expect((await load()).default).toContain('interface Array<T>')
  })
})
