import { use, useCallback } from 'react'
import { useSettingValue } from '@/hooks/use-setting-value'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { FileOpenIntentContext } from '@/lib/file-open-intent/providers/context'
import type {
  FileOpenIntent,
  FileOpenIntentInterest,
  FileOpenIntentSource,
  FileOpenIntentTrigger,
} from '@/lib/file-open-intent/state/service'

const noInterest: FileOpenIntentInterest = { release() {} }

/** Prepares one caller's file in its captured editor environment. */
export function useFileIntent(source: FileOpenIntentSource) {
  const context = use(FileOpenIntentContext)
  const master = useSettingValue('prefetch.enabled')
  const enabled = useSettingValue('prefetch.files') && master
  // Caller lifetime effects depend on this identity, including host context replacement.
  return useCallback(
    (
      path: FilesystemPath,
      trigger: FileOpenIntentTrigger,
      options: Pick<FileOpenIntent, 'knownSize' | 'rootPath' | 'tabId'> = {},
    ): FileOpenIntentInterest =>
      enabled && context
        ? context.service.prepare({ ...options, path, source, trigger })
        : noInterest,
    [context, enabled, source],
  )
}
