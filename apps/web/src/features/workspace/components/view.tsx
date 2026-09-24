import { SearchRuntime } from '@/features/workspace/components/search-runtime'
import { GitStoreProvider } from '@/features/git/providers/store-provider'
import { ChatModeSurfaceView } from '@/features/chat-mode/components/surface-view'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { EditorSurfaceLayoutView } from '@/features/workbench/components/editor-surface-layout-view'
import type { PickedFsEntry } from '@/lib/file-system-types'
import { KeepAliveProvider } from '@/lib/keep-alive/providers/keep-alive-provider'
import { SessionDialogs } from '@/components/session-dialogs'

type WorkspaceViewProps = {
  rootFolder: PickedFsEntry
}

export function WorkspaceView({ rootFolder }: WorkspaceViewProps) {
  const rootPath = rootFolder.path
  const uiMode = useEditorWorkspaceState((state) => state.uiMode)

  return (
    <GitStoreProvider rootPath={rootPath}>
      <SearchRuntime rootPath={rootPath} />
      <div className='h-full min-h-0 flex-1 overflow-auto'>
        <div className='flex h-full min-w-[1024px] flex-col'>
          <div className='relative min-h-0 flex-1 overflow-hidden' data-terminal-overlay-bounds>
            {/* Above the mode switch: a terminal outlives the surface that shows it. */}
            <KeepAliveProvider>
              {uiMode === 'chat' ? (
                <ChatModeSurfaceView rootPath={rootPath} />
              ) : (
                <EditorSurfaceLayoutView rootPath={rootPath} />
              )}
            </KeepAliveProvider>
            {/* Outside the mode switch: the row or header that asked is often the first
                thing to unmount once the answer is yes. */}
            <SessionDialogs />
          </div>
        </div>
      </div>
    </GitStoreProvider>
  )
}
