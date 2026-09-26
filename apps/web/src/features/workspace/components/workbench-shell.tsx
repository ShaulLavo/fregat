import { ChatModeSurfaceView } from '@/features/chat-mode/components/surface-view'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { EditorSurfaceLayoutView } from '@/features/workbench/components/editor-surface-layout-view'
import { ThemeStudioSlot } from '@/components/theme-studio-slot'
import type { FilesystemPath } from '@/lib/documents/utils/types'

/** The desktop shell: both workspace modes, laid out for a wide window. */
export function WorkbenchShell({ rootPath }: { readonly rootPath: FilesystemPath }) {
  const uiMode = useEditorWorkspaceState((state) => state.uiMode)

  return (
    <div className='h-full min-h-0 flex-1 overflow-auto'>
      <div className='flex h-full min-w-[1024px] flex-col'>
        <div className='relative min-h-0 flex-1 overflow-hidden' data-terminal-overlay-bounds>
          {uiMode === 'chat' ? (
            <ChatModeSurfaceView rootPath={rootPath} />
          ) : (
            <EditorSurfaceLayoutView rootPath={rootPath} />
          )}
        </div>
        <ThemeStudioSlot />
      </div>
    </div>
  )
}
