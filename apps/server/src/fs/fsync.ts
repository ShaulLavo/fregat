import { closeSync, fsyncSync, openSync } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'

export type SyncOpener = (
  target: string,
  flags: string,
) => Promise<Pick<FileHandle, 'close' | 'sync'>>

/** Flushes a file or a directory entry through `openHandle`, so a test driver can intercept it. */
export async function fsyncVia(openHandle: SyncOpener, target: string) {
  const handle = await openHandle(target, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export async function fsyncPath(target: string) {
  await fsyncVia(open, target)
}

export function fsyncPathSync(target: string) {
  const descriptor = openSync(target, 'r')
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}
