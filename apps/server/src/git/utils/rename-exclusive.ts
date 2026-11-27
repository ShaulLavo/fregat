import { lstatSync, mkdirSync, renameSync, rmdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isWasiRuntime } from '../../system/runtime'

// Directory publication must be one no-replace rename, including against an empty destination.
export function renameExclusive(
  source: string,
  destination: string,
  options: { readonly useNativeFfi?: boolean } = {},
) {
  const useNativeFfi = options.useNativeFfi ?? !isWasiRuntime()
  if (!useNativeFfi) return publishDirectoryWithoutReplace(source, destination)

  const { dlopen, ptr } = createRequire(import.meta.url)('bun:ffi') as typeof import('bun:ffi')
  const from = Buffer.from(`${source}\0`)
  const to = Buffer.from(`${destination}\0`)
  if (process.platform === 'darwin') {
    const library = dlopen('/usr/lib/libSystem.B.dylib', {
      renamex_np: { args: ['ptr', 'ptr', 'u32'], returns: 'i32' },
    })
    try {
      return library.symbols.renamex_np(ptr(from), ptr(to), 4) === 0
    } finally {
      library.close()
    }
  }
  const library = dlopen('libc.so.6', {
    renameat2: { args: ['i32', 'ptr', 'i32', 'ptr', 'u32'], returns: 'i32' },
  })
  try {
    return library.symbols.renameat2(-100, ptr(from), -100, ptr(to), 1) === 0
  } finally {
    library.close()
  }
}

/**
 * Claims an absent destination directory atomically via `mkdirSync` (failing with `EEXIST` if any
 * file or directory already exists there), then renames the staged directory into that placeholder.
 */
function publishDirectoryWithoutReplace(source: string, destination: string) {
  if (!isDirectory(source)) return false
  try {
    mkdirSync(destination)
  } catch {
    return false
  }
  try {
    renameSync(source, destination)
    return true
  } catch {
    try {
      rmdirSync(destination)
    } catch {
      // Leave the destination untouched if another writer populated or replaced it.
    }
    return false
  }
}

function isDirectory(target: string) {
  try {
    return lstatSync(target).isDirectory()
  } catch {
    return false
  }
}
