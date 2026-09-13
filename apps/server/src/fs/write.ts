import { randomUUID } from 'node:crypto'
import type { Stats } from 'node:fs'
import { open, readFile, rm, rename, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { FsError, mapNodeError } from './errors'
import { statOptional, type MutationTarget } from './mutation-target'
import { assertFile } from './stat'
import { decodeText, isByteExactText } from './text-encoding'
import type { WriteBody } from './contracts'
import { fileVersion, textFileVersion } from './version'

const temporaryFilePrefix = `.platform-write-${randomUUID()}-`
let issuedTemporaryFileCount = 0

export async function writeTextFile(
  target: MutationTarget<'content'>,
  body: Omit<WriteBody, 'path'>,
  maxBytes: number,
) {
  let tempPath: string | null = null

  try {
    const writePath = target.absolutePath
    const existing = await assertWritableTarget(writePath, {
      baseVersion: body.baseVersion,
      expectedMtimeMs: body.expectedMtimeMs,
      maxBytes,
    })
    const temporary = temporaryPath(writePath)
    const handle = await open(temporary, 'wx')
    tempPath = temporary
    await writeTemporaryContent(handle, body.content, existing?.mode)
    await rename(tempPath, writePath)
    tempPath = null
    await syncPath(path.dirname(writePath))
    return target.relativePath
  } catch (error) {
    await removeTempFile(tempPath)
    if (error instanceof FsError) throw error
    throw mapNodeError(error)
  }
}

async function writeTemporaryContent(handle: FileHandle, content: string, mode?: number) {
  try {
    await handle.writeFile(content, 'utf8')
    if (mode !== undefined) await handle.chmod(mode)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function assertWritableTarget(
  absolutePath: string,
  expected: { baseVersion?: string; expectedMtimeMs?: number; maxBytes: number },
) {
  const stats = await statOptional(absolutePath)
  if (!stats) {
    if (expected.baseVersion !== undefined) throw new FsError('FILE_CHANGED')
    return null
  }

  assertFile(stats)
  const bytes = await assertByteExactTarget(absolutePath, stats, expected.maxBytes)
  if (expected.baseVersion !== undefined) {
    const currentVersion = targetVersion(bytes, stats, expected.baseVersion)
    if (currentVersion !== expected.baseVersion) throw new FsError('FILE_CHANGED')
  }
  if (expected.expectedMtimeMs === undefined) return stats
  if (Math.abs(stats.mtimeMs - expected.expectedMtimeMs) <= 1) return stats

  throw new FsError('FILE_CHANGED')
}

/**
 * The read boundary decodes anything, so text can reach the editor with U+FFFD where bytes used to
 * be, or transcoded out of UTF-16. Writing that text back would commit the substitution to disk, so
 * the overwrite is refused here rather than by refusing to open the file in the first place. This
 * is the one place we are deliberately stricter than VS Code, which lets the mangled save through.
 */
async function assertByteExactTarget(absolutePath: string, stats: Stats, maxBytes: number) {
  // Too large to have been opened as text at all, so no editor buffer can be its faithful source.
  if (stats.size > maxBytes) throw new FsError('LOSSY_WRITE_BLOCKED')
  const bytes = await readFile(absolutePath)
  if (!isByteExactText(bytes)) throw new FsError('LOSSY_WRITE_BLOCKED')

  return bytes
}

async function syncPath(target: string) {
  const handle = await open(target, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function targetVersion(bytes: Uint8Array, stats: Stats, baseVersion: string) {
  if (!baseVersion.startsWith('sha256:')) return fileVersion(stats)

  // Safe to decode here: `assertByteExactTarget` has already proven these bytes are UTF-8.
  return textFileVersion(decodeText(bytes).content)
}

function temporaryPath(absolutePath: string) {
  return path.join(
    path.dirname(absolutePath),
    `${temporaryFilePrefix}${++issuedTemporaryFileCount}.tmp`,
  )
}

export function isWriteTemporaryPath(input: string) {
  const name = path.basename(input)
  if (!name.startsWith(temporaryFilePrefix) || !name.endsWith('.tmp')) return false
  const sequence = Number(name.slice(temporaryFilePrefix.length, -4))
  return (
    Number.isSafeInteger(sequence) &&
    sequence > 0 &&
    sequence <= issuedTemporaryFileCount &&
    name === `${temporaryFilePrefix}${sequence}.tmp`
  )
}

async function removeTempFile(tempPath: string | null) {
  if (!tempPath) return

  try {
    await rm(tempPath, { force: true })
  } catch {
    return
  }
}
