import { randomUUID } from 'node:crypto'
import type { Stats } from 'node:fs'
import { open, readFile, rm, rename, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { FsError, mapNodeError } from './errors'
import { statOptional, type MutationTarget } from './mutation-target'
import { assertFile } from './stat'
import type { WriteBody } from './contracts'
import { fileVersion, textFileVersion } from './version'

export async function writeTextFile(
  target: MutationTarget<'content'>,
  body: Omit<WriteBody, 'path'>,
) {
  let tempPath: string | null = null

  try {
    const writePath = target.absolutePath
    const existing = await assertWritableTarget(writePath, {
      baseVersion: body.baseVersion,
      expectedMtimeMs: body.expectedMtimeMs,
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
  expected: { baseVersion?: string; expectedMtimeMs?: number },
) {
  const stats = await statOptional(absolutePath)
  if (!stats) {
    if (expected.baseVersion !== undefined) throw new FsError('FILE_CHANGED')
    return null
  }

  assertFile(stats)
  if (expected.baseVersion !== undefined) {
    const currentVersion = await targetVersion(absolutePath, stats, expected.baseVersion)
    if (currentVersion !== expected.baseVersion) throw new FsError('FILE_CHANGED')
  }
  if (expected.expectedMtimeMs === undefined) return stats
  if (Math.abs(stats.mtimeMs - expected.expectedMtimeMs) <= 1) return stats

  throw new FsError('FILE_CHANGED')
}

async function syncPath(target: string) {
  const handle = await open(target, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function targetVersion(absolutePath: string, stats: Stats, baseVersion: string) {
  if (!baseVersion.startsWith('sha256:')) return fileVersion(stats)

  return textFileVersion(await readFile(absolutePath, 'utf8'))
}

function temporaryPath(absolutePath: string) {
  return path.join(
    path.dirname(absolutePath),
    `.${path.basename(absolutePath)}.${randomUUID()}.tmp`,
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
