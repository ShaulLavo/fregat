import { use } from 'react'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { FileOpenIntentContext } from '@/lib/file-open-intent/providers/context'
import type {
  FileOpenIntentSource,
  FileOpenIntentTrigger,
} from '@/lib/file-open-intent/state/service'

/**
 * Prepares the file a press on `path` would open, in the editor's current root unless the caller
 * names the root it resolved against. Outside an editor runtime there is nothing to prepare into.
 */
export function useFileIntent(source: FileOpenIntentSource) {
  const service = use(FileOpenIntentContext)?.service ?? null
  return (
    path: FilesystemPath,
    trigger: FileOpenIntentTrigger,
    options: { readonly knownSize?: number; readonly rootPath?: FilesystemPath } = {},
  ) => service?.prepare({ ...options, path, source, trigger })
}
