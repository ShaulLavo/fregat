import { randomUUID } from 'node:crypto'
import { nodeErrorCode } from '@workspace/contracts/error-fields'
import { chmodSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { chmod, open, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fsyncPathSync, fsyncVia, type SyncOpener } from './fsync'

/**
 * `rename` only swaps the file in; `fsync-file` also flushes the bytes before the swap;
 * `fsync-all` also flushes the directory entry after it. Every caller names one.
 */
export type AtomicWriteDurability = 'rename' | 'fsync-file' | 'fsync-all'

export type AtomicWriteDriver = {
  chmod(path: string, mode: number): Promise<void>
  open: SyncOpener
  rename(from: string, to: string): Promise<void>
  rm(path: string, options: { force: boolean; recursive: boolean }): Promise<void>
  writeFile(
    path: string,
    data: string | Uint8Array,
    options: { flag: string; mode?: number },
  ): Promise<void>
}

type AtomicWriteOptions = {
  readonly driver?: AtomicWriteDriver
  readonly durability: AtomicWriteDurability
}

type StageOptions = AtomicWriteOptions & {
  /** Applied with `chmod` after the create, so the result does not depend on the umask. */
  readonly mode?: number
}

const nodeDriver: AtomicWriteDriver = { chmod, open, rename, rm, writeFile }

/** Beside the target, so the rename never crosses a filesystem. */
export function atomicTemporaryPath(target: string) {
  return path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`)
}

/**
 * Writes through a temporary file renamed over `target`, which is removed if the rename never
 * happens. Throws the raw node error.
 */
export async function writeFileAtomic(
  target: string,
  data: string | Uint8Array,
  options: StageOptions & { readonly temporary?: string },
) {
  const temporary = options.temporary ?? atomicTemporaryPath(target)
  await stageAtomicWrite(temporary, data, options)
  let committed = false
  try {
    await commitAtomicWrite(temporary, target, options)
    committed = true
  } finally {
    if (!committed) await removeTemporary(options.driver ?? nodeDriver, temporary)
  }
}

/** The first half, for a caller that checks a precondition between the write and the rename. */
export async function stageAtomicWrite(
  temporary: string,
  data: string | Uint8Array,
  options: StageOptions,
) {
  const driver = options.driver ?? nodeDriver
  let created = false
  try {
    await driver.writeFile(temporary, data, { flag: 'wx', mode: options.mode })
    created = true
    if (options.mode !== undefined) await driver.chmod(temporary, options.mode)
    if (options.durability !== 'rename') await fsyncVia(driver.open, temporary)
  } catch (error) {
    // An exclusive-create collision belongs to another writer.
    if (created || nodeErrorCode(error) !== 'EEXIST') await removeTemporary(driver, temporary)
    throw error
  }
}

export async function commitAtomicWrite(
  temporary: string,
  target: string,
  options: AtomicWriteOptions,
) {
  const driver = options.driver ?? nodeDriver
  await driver.rename(temporary, target)
  if (options.durability === 'fsync-all') await fsyncVia(driver.open, path.dirname(target))
}

export function writeFileAtomicSync(
  target: string,
  data: string | Uint8Array,
  options: Omit<StageOptions, 'driver'>,
) {
  const temporary = atomicTemporaryPath(target)
  let created = false
  try {
    writeFileSync(temporary, data, { flag: 'wx', mode: options.mode })
    created = true
    if (options.mode !== undefined) chmodSync(temporary, options.mode)
    if (options.durability !== 'rename') fsyncPathSync(temporary)
    renameSync(temporary, target)
  } catch (error) {
    if (created || nodeErrorCode(error) !== 'EEXIST') rmSync(temporary, { force: true })
    throw error
  }
  if (options.durability === 'fsync-all') fsyncPathSync(path.dirname(target))
}

// The write's own error is the one worth reporting; a failed cleanup must not replace it.
async function removeTemporary(driver: AtomicWriteDriver, temporary: string) {
  await driver.rm(temporary, { force: true, recursive: false }).catch(() => undefined)
}
