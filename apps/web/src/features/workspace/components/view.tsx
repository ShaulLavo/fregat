import { SearchRuntime } from '@/features/workspace/components/search-runtime'
import { GitStoreProvider } from '@/features/git/providers/store-provider'
import { useDisplayedShell } from '@/features/workspace/hooks/use-displayed-shell'
import type { PickedFsEntry } from '@/lib/file-system-types'
import { KeepAliveProvider } from '@/lib/keep-alive/providers/keep-alive-provider'
import { DeferredThemeStudioSlot } from '@/components/deferred-theme-studio-slot'
import { DeferredSessionDialogs } from '@/components/deferred-session-dialogs'
import { ShellBody } from '@/features/workspace/components/shell-body'

type WorkspaceViewProps = {
  rootFolder: PickedFsEntry
}

export function WorkspaceView({ rootFolder }: WorkspaceViewProps) {
  const rootPath = rootFolder.path
  const { query } = useDisplayedShell()

  return (
    <GitStoreProvider rootPath={rootPath}>
      <SearchRuntime rootPath={rootPath} />
      {/* Above the shell switch: a terminal outlives the shell that shows it. */}
      <KeepAliveProvider>
        <ShellBody query={query} rootPath={rootPath} />
      </KeepAliveProvider>
      {/* Outside the shell switch: the row or header that asked is often the first
          thing to unmount once the answer is yes. */}
      <DeferredSessionDialogs />
      <DeferredThemeStudioSlot />
    </GitStoreProvider>
  )
}
