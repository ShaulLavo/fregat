import { AppShell } from '@/components/app-shell'
import { useDirtyTabCloseRequest } from '@/features/editor/hooks/use-dirty-tab-close'
import { EditorTabActionsProvider } from '@/features/editor/providers/tab-actions-provider'
import { useRestoreRecentWorkspaceRoot } from '@/features/workspace/hooks/use-restore-recent-root'
import { useWorkspaceCachePersistence } from '@/features/workspace/hooks/use-cache-persistence'
import { useAutoSave } from '@/features/editor/hooks/use-auto-save'
import { CommandProvider } from '@/keymap/providers/command-provider'
import { ComposerAttachProvider } from '@/providers/composer-attach-provider'
import { DiagnosticFixProvider } from '@/providers/diagnostic-fix-provider'

export function AppRuntimeContent() {
  const { dirtyTabCloseDialog, requestCloseTab, requestCloseTabs } = useDirtyTabCloseRequest()

  // Subscribe before recovery so a recovered root recreates its erased cache entry.
  useWorkspaceCachePersistence()
  // Mounted beside the cache persistence: both need the document store, and both
  // are app-lifetime concerns rather than anything a pane owns.
  useAutoSave()
  const restoringWorkspace = useRestoreRecentWorkspaceRoot()

  return (
    <EditorTabActionsProvider requestCloseTab={requestCloseTab} requestCloseTabs={requestCloseTabs}>
      <CommandProvider>
        <ComposerAttachProvider>
          <DiagnosticFixProvider>
            <AppShell
              dirtyTabCloseDialog={dirtyTabCloseDialog}
              restoringWorkspace={restoringWorkspace}
            />
          </DiagnosticFixProvider>
        </ComposerAttachProvider>
      </CommandProvider>
    </EditorTabActionsProvider>
  )
}
