import { createContext, use, type ReactNode } from 'react'

import { clientErrors } from '@/lib/structured-errors'
import type { FileOpenIntentService } from '@/lib/file-open-intent/state/service'

export type FileOpenIntentContextValue = {
  readonly service: FileOpenIntentService
}

const FileOpenIntentContext = createContext<FileOpenIntentContextValue | null>(null)

export function FileOpenIntentProvider({
  children,
  value,
}: {
  readonly children: ReactNode
  readonly value: FileOpenIntentContextValue
}) {
  return <FileOpenIntentContext value={value}>{children}</FileOpenIntentContext>
}

export function useFileOpenIntent() {
  const value = use(FileOpenIntentContext)
  if (!value) {
    throw clientErrors.CONTEXT_MISSING({
      message: 'useFileOpenIntent must be used within FileOpenIntentProvider',
    })
  }
  return value
}
