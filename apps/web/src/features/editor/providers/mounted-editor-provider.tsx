import type { ReactNode } from 'react'

import { MountedEditorContext } from '@/features/editor/providers/mounted-editor-context'
import type { MountedEditorRegistry } from '@/features/editor/state/mounted-editor-registry'

export function MountedEditorProvider({
  children,
  registry,
}: {
  readonly children: ReactNode
  readonly registry: MountedEditorRegistry
}) {
  return <MountedEditorContext value={registry}>{children}</MountedEditorContext>
}
