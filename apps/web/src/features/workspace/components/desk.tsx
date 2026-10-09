import { DeferredSurfaceView } from '@/features/chat-mode/components/deferred-surface'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { EditorSurfaceLayoutView } from '@/features/workbench/components/editor-surface-layout-view'
import { useRestoreDeskMode } from '@/features/workspace/hooks/use-restore-desk-mode'
import type { FilesystemPath } from '@/lib/documents/utils/types'

/** Both workspace modes, laid out for a wide window. */
export function Desk({ rootPath }: { readonly rootPath: FilesystemPath }) {
  const uiMode = useEditorWorkspaceState((state) => state.uiMode)
  useRestoreDeskMode()

  return (
    <div className='h-full min-h-0 flex-1 overflow-auto'>
      <div className='flex h-full min-w-[1024px] flex-col'>
        <div className='relative min-h-0 flex-1 overflow-hidden' data-terminal-overlay-bounds>
          {uiMode === 'chat' ? (
            <DeferredSurfaceView rootPath={rootPath} />
          ) : (
            <EditorSurfaceLayoutView rootPath={rootPath} />
          )}
        </div>
      </div>
    </div>
  )
}
