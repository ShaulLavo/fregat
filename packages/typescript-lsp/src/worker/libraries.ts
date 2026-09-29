import ts from 'typescript'
import { BUNDLED_LIBRARY_FILES } from './bundledLibraries'

const CDN_ROOT = 'https://playgroundcdn.typescriptlang.org/cdn'
const LIBRARY_ALIASES = new Map([
  ['es6', 'es2015'],
  ['es7', 'es2016'],
])

/** Reads library files by name (`lib.es5.d.ts`); a name it does not know is left out. */
export type LibraryFileReader = (names: readonly string[]) => Promise<ReadonlyMap<string, string>>

/**
 * The standard library a program with these options reads, keyed as the project host serves it
 * (`/lib.es5.d.ts`). Only the reference closure is loaded: a default lib names the libs it needs
 * with `/// <reference lib>`, so the files arrive a reference depth at a round: for ES2023, 67 of
 * the 108 in 10 rounds.
 */
export async function loadLibraryFiles(
  options: ts.CompilerOptions,
  read: LibraryFileReader,
): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  const seen = new Set<string>()
  let pending = entryLibraries(options)
  while (pending.length > 0) {
    for (const name of pending) seen.add(name)
    const texts = await read(pending)
    const next: string[] = []
    for (const [name, text] of texts) {
      files.set(`/${name}`, text)
      for (const reference of referencedLibraries(text)) {
        if (!seen.has(reference)) next.push(reference)
      }
    }
    pending = [...new Set(next)]
  }
  return files
}

/** `es2024`, `ES2024` and `lib.es2024.d.ts` are the same library to a tsconfig. */
export function libraryFileName(name: string): string {
  const bare = name
    .toLowerCase()
    .replace(/^lib\./, '')
    .replace(/\.d\.ts$/, '')
  return `lib.${LIBRARY_ALIASES.get(bare) ?? bare}.d.ts`
}

export const readBundledLibraryFiles: LibraryFileReader = async (names) => {
  const loaded = await Promise.all(
    names.map(async (name) => {
      const load = BUNDLED_LIBRARY_FILES[name]
      return load ? ([name, (await load()).default] as const) : null
    }),
  )
  return new Map(loaded.filter((entry) => entry !== null))
}

/** The TypeScript playground's copy for this exact TypeScript version; a host has to ask for it. */
export const readCdnLibraryFiles: LibraryFileReader = async (names) => {
  const loaded = await Promise.all(
    names.map(async (name) => {
      const response = await fetch(`${CDN_ROOT}/${ts.version}/typescript/lib/${name}`)
      return response.ok ? ([name, await response.text()] as const) : null
    }),
  )
  return new Map(loaded.filter((entry) => entry !== null))
}

function entryLibraries(options: ts.CompilerOptions): string[] {
  if (options.noLib) return []
  if (options.lib?.length) return options.lib.map(libraryFileName)
  return [ts.getDefaultLibFileName(options)]
}

function referencedLibraries(text: string): string[] {
  return ts
    .preProcessFile(text, true, true)
    .libReferenceDirectives.map((reference) => libraryFileName(reference.fileName))
}
