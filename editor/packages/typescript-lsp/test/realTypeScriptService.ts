/*
 * A real `ts.LanguageService` over a virtual file system, with the network switched off.
 *
 * The worker loads its `lib.*.d.ts` files off the TypeScript playground CDN by default. No suite of
 * ours may do that: a test that fails when a CDN blinks is a test nobody trusts, and CI has no
 * business dialling out. The identical lib files already sit in `node_modules/typescript/lib`, and
 * this reads them from there for the session's `loadLibraryFiles` seam.
 *
 * The suites and `bench/semanticClassification.ts` share this module because a benchmark that
 * measures a differently-built service is measuring something no test asserts about.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { resolvedCompilerOptions } from '../src/worker/project'
import { ProjectHost } from '../src/worker/projectHost'

// Reading a hundred-odd lib files is a few megabytes of I/O, and every suite in this file's orbit
// wants the same bytes. Read them once per process.
let libraryFiles: ReadonlyMap<string, string> | null = null

/**
 * The `lib.*.d.ts` set the CDN would have served, keyed the way `createSystem` expects it — a
 * leading slash and nothing else, because that is what `getDefaultLibFileName` resolves to.
 */
export const typeScriptLibraryFilesFromDisk = (): ReadonlyMap<string, string> => {
  if (libraryFiles) return libraryFiles

  const directory = typeScriptLibraryDirectory()
  const files = new Map<string, string>()
  for (const entry of readdirSync(directory)) {
    if (!isLibraryFileName(entry)) continue
    files.set(`/${entry}`, readFileSync(join(directory, entry), 'utf8'))
  }

  libraryFiles = files
  return files
}

/** The session's `readLibraryFiles` seam, answered from the same files. */
export const libraryFilesFromDisk = (names: readonly string[]): ReadonlyMap<string, string> => {
  const files = typeScriptLibraryFilesFromDisk()
  const found = new Map<string, string>()
  for (const name of names) {
    const text = files.get(`/${name}`)
    if (text !== undefined) found.set(name, text)
  }
  return found
}

/** Builds a language service whose only source files are the ones handed in, plus the libs. */
export const createRealTypeScriptService = (
  sourceFiles: ReadonlyMap<string, string>,
): ProjectHost => {
  const files = new Map(typeScriptLibraryFilesFromDisk())
  for (const [fileName, text] of sourceFiles) files.set(fileName, text)

  return new ProjectHost(files, Array.from(sourceFiles.keys()), resolvedCompilerOptions(null, {}))
}

const isLibraryFileName = (entry: string): boolean =>
  entry.startsWith('lib.') && entry.endsWith('.d.ts')

// `require.resolve` rather than a relative path: bun hoists this package's `typescript` to wherever
// it likes, and a hardcoded `../../node_modules` walks off a cliff the first time it does.
const typeScriptLibraryDirectory = (): string =>
  dirname(createRequire(import.meta.url).resolve('typescript'))
