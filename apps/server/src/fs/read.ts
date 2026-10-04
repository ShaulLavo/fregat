import type { BigIntStats } from 'node:fs'
import { open, stat, type FileHandle } from 'node:fs/promises'
import { FsError, mapNodeError } from './errors'
import { resolveExistingPath, type WorkspacePaths } from './path'
import { assertFile } from './stat'
import {
  detectTextEncoding,
  decodeText,
  type DecodedText,
  type TextEncodingLabel,
} from '@workspace/contracts/text-encoding'
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
    const { bytes, ...metadata } = await readFileBytes(paths, input, maxBytes, options)
    return { ...metadata, ...decodeText(bytes) }
  } catch (error) {
    if (error instanceof FsError) throw error
    throw mapNodeError(error)
  }
}

export async function readFileBytes(
  paths: WorkspacePaths,
  input: string,
  maxBytes: number,
  options: ReadTextFileOptions = {},
) {
  try {
    const target = await resolveExistingPath(paths, input)
    const handle = await open(target.absolutePath, 'r')
    try {
      return await readOpenedFileBytes(handle, target.relativePath, maxBytes, options)
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (error instanceof FsError) throw error
    throw mapNodeError(error)
  }
}

async function readOpenedFileBytes(
  handle: FileHandle,
  path: string,
  maxBytes: number,
  options: ReadTextFileOptions,
) {
  const stats = await handle.stat()
  assertFile(stats)
  assertReadSize(stats.size, maxBytes)
  const bytes = await handle.readFile()
  assertReadSize(bytes.length, maxBytes)
  const after = await handle.stat()
  if (
    after.size !== stats.size ||
    after.mtimeMs !== stats.mtimeMs ||
    after.ctimeMs !== stats.ctimeMs
  )
    throw new FsError('FILE_CHANGED')
  if (options.acceptTextOnly && detectTextEncoding(bytes).seemsBinary)
    throw new FsError('FILE_IS_BINARY')
  return {
    bytes,
    path,
    mtimeMs: stats.mtimeMs,
    size: bytes.length,
    version: textFileVersion(bytes),
  }
}

function assertReadSize(size: number, maxBytes: number) {
  if (size > maxBytes)
    throw new FsError('FILE_TOO_LARGE', undefined, undefined, { internal: { size, maxBytes } })
}

export type TextHeadResult = {
  path: string
  content: string
  size: number
  /** The file goes on past `content`. */
  truncated: boolean
  /** File identity and metadata checked on the descriptor and named path across this read. */
  capture: {
    device: string
    inode: string
    size: number
    mtimeNs: string
    ctimeNs: string
  }
  coverage: TextHeadCoverage
}

type TextHeadCoverage = {
  /** Byte and UTF-16 coverage both start at zero. */
  bytesRead: number
  /** Bytes supplied to decoding after line trimming. */
  decodedBytes: number
  /** UTF-16 code units in `content`. */
  utf16Length: number
} & (
  | { kind: 'complete'; version: string; encoding: 'utf8'; lossy: false; lineTrimmed: false }
  | (Pick<DecodedText, 'encoding' | 'lossy'> & { kind: 'partial'; lineTrimmed: boolean })
  | { kind: 'lossy'; encoding: TextEncodingLabel; lossy: true; lineTrimmed: false }
)

export type TextHeadFileSystem = {
  open: (path: string) => Promise<{
    stat: () => Promise<BigIntStats>
    read: (
      buffer: Uint8Array,
      offset: number,
      length: number,
      position: number,
    ) => Promise<{ bytesRead: number }>
    close: () => Promise<void>
  }>
  stat: (path: string) => Promise<BigIntStats>
}

const textHeadFileSystem: TextHeadFileSystem = {
  async open(path) {
    const handle = await open(path, 'r')
    return {
      stat: () => handle.stat({ bigint: true }),
      read: (buffer, offset, length, position) => handle.read(buffer, offset, length, position),
      close: () => handle.close(),
    }
  },
  stat: (path) => stat(path, { bigint: true }),
}

/** A bounded head, ending at the last newline when one fits inside a partial read. */
export async function readTextHead(
  paths: WorkspacePaths,
  input: string,
  maxBytes: number,
  fs: TextHeadFileSystem = textHeadFileSystem,
): Promise<TextHeadResult> {
  try {
    const target = await resolveExistingPath(paths, input)
    const handle = await fs.open(target.absolutePath)
    try {
      return await readOpenedTextHead(paths, target, handle, maxBytes, fs)
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (error instanceof FsError) throw error
    throw mapNodeError(error)
  }
}

type TextHeadHandle = Awaited<ReturnType<TextHeadFileSystem['open']>>

async function readOpenedTextHead(
  paths: WorkspacePaths,
  target: Awaited<ReturnType<typeof resolveExistingPath>>,
  handle: TextHeadHandle,
  maxBytes: number,
  fs: TextHeadFileSystem,
): Promise<TextHeadResult> {
  const stats = await handle.stat()
  if (!stats.isFile()) throw new FsError('NOT_A_FILE')
  const size = Number(stats.size)
  if (!Number.isSafeInteger(size)) throw new FsError('FILE_TOO_LARGE')
  await assertHeadCapture(paths, target, handle, stats, fs)
  const bytes = new Uint8Array(Math.min(maxBytes, size))
  await readHeadBytes(handle, bytes)
  await assertHeadCapture(paths, target, handle, stats, fs)
  const truncated = size > bytes.length
  const textBytes = truncated ? wholeLines(bytes) : bytes
  const decoded = decodeText(textBytes)
  if (decoded.seemsBinary) throw new FsError('FILE_IS_BINARY')
  return {
    path: target.relativePath,
    content: decoded.content,
    size,
    truncated,
    capture: {
      device: String(stats.dev),
      inode: String(stats.ino),
      size,
      mtimeNs: String(stats.mtimeNs),
      ctimeNs: String(stats.ctimeNs),
    },
    coverage: headCoverage(bytes, textBytes, decoded, truncated),
  }
}

async function readHeadBytes(handle: TextHeadHandle, bytes: Uint8Array) {
  let offset = 0
  while (offset < bytes.length) {
    const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
    if (bytesRead === 0) throw new FsError('FILE_CHANGED')
    offset += bytesRead
  }
}

async function assertHeadCapture(
  paths: WorkspacePaths,
  target: Awaited<ReturnType<typeof resolveExistingPath>>,
  handle: TextHeadHandle,
  expected: BigIntStats,
  fs: TextHeadFileSystem,
) {
  const named = await resolveExistingPath(paths, target.relativePath).catch(() => {
    throw new FsError('FILE_CHANGED')
  })
  if (named.absolutePath !== target.absolutePath) throw new FsError('FILE_CHANGED')
  const [opened, current] = await Promise.all([
    handle.stat(),
    fs.stat(paths.resolve(target.relativePath).absolutePath),
  ]).catch(() => {
    throw new FsError('FILE_CHANGED')
  })
  if (!sameHeadFacts(expected, opened) || !sameHeadFacts(expected, current))
    throw new FsError('FILE_CHANGED')
}

function sameHeadFacts(expected: BigIntStats, actual: BigIntStats) {
  return (
    expected.dev === actual.dev &&
    expected.ino === actual.ino &&
    expected.size === actual.size &&
    expected.mtimeNs === actual.mtimeNs &&
    expected.ctimeNs === actual.ctimeNs
  )
}

function headCoverage(
  bytes: Uint8Array,
  textBytes: Uint8Array,
  decoded: DecodedText,
  truncated: boolean,
): TextHeadCoverage {
  const coverage = {
    bytesRead: bytes.length,
    decodedBytes: textBytes.length,
    utf16Length: decoded.content.length,
    encoding: decoded.encoding,
    lossy: decoded.lossy,
    lineTrimmed: textBytes.length < bytes.length,
  }
  if (truncated) return { ...coverage, kind: 'partial' }
  if (decoded.lossy || decoded.encoding !== 'utf8')
    return { ...coverage, kind: 'lossy', lossy: true, lineTrimmed: false }
  return {
    ...coverage,
    kind: 'complete',
    encoding: 'utf8',
    lossy: false,
    lineTrimmed: false,
    version: textFileVersion(bytes),
  }
}

function wholeLines(bytes: Uint8Array) {
  const lastNewline = bytes.lastIndexOf(0x0a)
  return lastNewline < 0 ? bytes : bytes.subarray(0, lastNewline + 1)
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
