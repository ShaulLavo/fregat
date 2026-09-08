import { readFile, stat } from 'node:fs/promises'
import { FsError, mapNodeError } from './errors'
import { resolveExistingPath, type WorkspacePaths } from './path'
import { assertFile } from './stat'
import { fileVersion, textFileVersion } from './version'

export type ReadFileResult = {
  path: string
  content: string
  mtimeMs: number
  size: number
  version: string
}

export type BlobFileResult = {
  absolutePath: string
  path: string
  mtimeMs: number
  size: number
  version: string
}

export async function readTextFile(
  paths: WorkspacePaths,
  input: string,
  maxBytes: number,
): Promise<ReadFileResult> {
  try {
    const target = await resolveExistingPath(paths, input)
    const stats = await stat(target.absolutePath)
    assertFile(stats)
    if (stats.size > maxBytes) throw new FsError('FILE_TOO_LARGE')
    const bytes = await readFile(target.absolutePath)
    const content = decodeTextFile(bytes)

    return {
      path: target.relativePath,
      content,
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      version: textFileVersion(content),
    }
  } catch (error) {
    if (error instanceof FsError) throw error
    throw mapNodeError(error)
  }
}

const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

function decodeTextFile(bytes: Uint8Array) {
  let content: string

  try {
    content = textDecoder.decode(bytes)
  } catch (error) {
    throw new FsError('INVALID_TEXT_FILE', undefined, error)
  }

  if (content.includes('\0')) throw new FsError('INVALID_TEXT_FILE')

  return content
}

export async function getBlobFile(paths: WorkspacePaths, input: string): Promise<BlobFileResult> {
  try {
    const target = await resolveExistingPath(paths, input)
    const stats = await stat(target.absolutePath)
    assertFile(stats)

    return {
      absolutePath: target.absolutePath,
      path: target.relativePath,
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      version: fileVersion(stats),
    }
  } catch (error) {
    if (error instanceof FsError) throw error
    throw mapNodeError(error)
  }
}
