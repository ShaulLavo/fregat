import path from 'node:path'
import {
  CHAT_ATTACHMENT_FILE_EXTENSIONS,
  chatAttachmentExtension,
  type ChatAttachment,
} from '@workspace/contracts'

/**
 * Inverse of the contract's mime allowlist, for the one direction the blob
 * route needs: a request carries a file name and has to answer with a
 * content type. Unknown extension means "not one of ours", never a guess.
 */
export function mimeTypeForAttachmentFileName(fileName: string): string | null {
  const extension = path.extname(fileName).toLowerCase()
  if (!extension) return null

  for (const [mimeType, candidate] of Object.entries(CHAT_ATTACHMENT_FILE_EXTENSIONS)) {
    if (candidate === extension) return mimeType
  }

  return null
}

/**
 * Collapses a caller-supplied relative path to a safe, forward-slashed form, or
 * returns null when the input has no business addressing a blob: empty, NUL
 * poisoned, absolute, or escaping its root with `..`.
 */
export function normalizeAttachmentRelativePath(raw: string): string | null {
  if (raw.includes('\0')) return null
  // win32.isAbsolute is the superset check: it catches POSIX '/x', drive paths
  // 'C:\x', and UNC '\\x' regardless of the host platform.
  if (path.win32.isAbsolute(raw)) return null

  const normalized = path.normalize(raw).replaceAll('\\', '/')
  if (normalized.length === 0 || normalized === '.') return null
  if (normalized === '..' || normalized.startsWith('../')) return null
  return normalized
}

/**
 * The traversal guard. Resolves a relative path against the attachments root
 * and returns null unless the result is strictly inside that root.
 */
export function resolveAttachmentRelativePath(input: {
  readonly attachmentsDir: string
  readonly relativePath: string
}): string | null {
  const relativePath = normalizeAttachmentRelativePath(input.relativePath)
  if (!relativePath) return null

  const attachmentsRoot = path.resolve(input.attachmentsDir)
  const filePath = path.resolve(attachmentsRoot, relativePath)
  if (!filePath.startsWith(`${attachmentsRoot}${path.sep}`)) return null
  return filePath
}

/**
 * Blob file name for an attachment. Null when the mime type is outside the
 * Anthropic allowlist, or when the id would produce anything other than a
 * single safe path segment.
 */
export function attachmentFileName(attachment: ChatAttachment): string | null {
  const extension =
    attachment.type === 'file' ? '.bin' : chatAttachmentExtension(attachment.mimeType)
  if (!extension) return null

  const fileName = normalizeAttachmentRelativePath(`${attachment.id}${extension}`)
  if (!fileName || fileName.includes('/')) return null
  return fileName
}
