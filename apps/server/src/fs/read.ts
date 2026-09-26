import { readFile, stat } from 'node:fs/promises'
import { FsError, mapNodeError } from './errors'
import { resolveExistingPath, type WorkspacePaths } from './path'
import { assertFile } from './stat'
import { decodeText, type TextEncodingLabel } from './text-encoding'
import { fileVersion, textFileVersion } from './version'

export type ReadFileResult = {
  path: string
  content: string
  mtimeMs: number
  size: number
  version: string
  encoding: TextEncodingLabel
  lossy: boolean
  seemsBinary: boolean
}

export type BlobFileResult = {
  absolutePath: string
  path: string
  mtimeMs: number
  size: number
  version: string
}

export type ReadTextFileOptions = {
  /**
   * Fail with `FILE_IS_BINARY` instead of decoding a file that looks binary. Off by default: the
   * read boundary decodes whatever it is given, and callers that would rather skip binaries — an
   * indexer, a diff generator — opt in. See `text-encoding.ts` for why the default is permissive.
   */
  readonly acceptTextOnly?: boolean
}

export async function readTextFile(
  paths: WorkspacePaths,
  input: string,
  maxBytes: number,
  options: ReadTextFileOptions = {},
): Promise<ReadFileResult> {
  try {
    const target = await resolveExistingPath(paths, input)
    const stats = await stat(target.absolutePath)
    assertFile(stats)
    if (stats.size > maxBytes)
      throw new FsError('FILE_TOO_LARGE', undefined, undefined, {
        internal: { size: stats.size, maxBytes },
      })
    const bytes = await readFile(target.absolutePath)
    const decoded = decodeText(bytes)
    if (decoded.seemsBinary && options.acceptTextOnly) throw new FsError('FILE_IS_BINARY')

    return {
      path: target.relativePath,
      content: decoded.content,
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      version: textFileVersion(decoded.content),
      encoding: decoded.encoding,
      lossy: decoded.lossy,
      seemsBinary: decoded.seemsBinary,
    }
  } catch (error) {
    if (error instanceof FsError) throw error
    throw mapNodeError(error)
  }
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
