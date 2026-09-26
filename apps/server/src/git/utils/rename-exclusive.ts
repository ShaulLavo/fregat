import { dlopen, ptr } from 'bun:ffi'

// Directory publication must be one no-replace rename, including against an empty destination.
export function renameExclusive(source: string, destination: string) {
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
