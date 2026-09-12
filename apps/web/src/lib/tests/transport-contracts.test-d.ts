import type { Client } from '@/lib/client'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { fetchFile, writeFileContent } from '@/lib/file-server'
import { connectLanguageServerSocket } from '@/lib/server-sockets'

export function checkTransportOwnership(path: FilesystemPath, signal: AbortSignal, client: Client) {
  // @ts-expect-error Reads require their captured owner.
  fetchFile(path, signal)
  // @ts-expect-error Writes require their captured owner.
  writeFileContent(path, '', undefined)
  // @ts-expect-error A socket cannot infer either owner or lifetime from selection.
  connectLanguageServerSocket({ path, rootPath: path })
  // @ts-expect-error An explicit client alone does not identify the socket lifetime.
  connectLanguageServerSocket({ path, rootPath: path }, client)
}
