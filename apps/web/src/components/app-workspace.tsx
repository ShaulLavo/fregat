import { EmptyWorkspace } from '@/components/empty-workspace'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { ProjectPicker } from '@/features/environments/components/project-picker'
import { useConnectedMachines } from '@/hooks/use-connected-machines'
import { useQueryClient } from '@tanstack/react-query'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import { primaryServerOrigin } from '@/lib/client'
import { usePickEntry } from '@/components/use-pick-entry'
import { WorkspaceView } from '@/features/workspace/components/view'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { useOpenWorkspaceRoot } from '@/features/workspace/hooks/use-open-root'
import { useValidateRootFolder } from '@/features/workspace/hooks/use-validate-root-folder'
import { useWorkspaceEvents } from '@/features/workspace/hooks/use-events'
import { log } from '@/lib/client-logging'
import type { PickedFsEntry } from '@/lib/file-system-types'

export function AppWorkspace({ restoringWorkspace }: { readonly restoringWorkspace: boolean }) {
  const machines = useConnectedMachines()
  const origin = originForQueryClient(useQueryClient())
  const chooseMachine = machines.length > 1 || origin !== primaryServerOrigin()
  const pickerOpen = useEditorWorkspaceState((state) => state.pickerOpen)
  const rootFolder = useEditorWorkspaceState((state) => state.rootFolder)
  const openPicker = useEditorWorkspaceState((state) => state.openPicker)
  const setPickerOpen = useEditorWorkspaceState((state) => state.setPickerOpen)
  const openWorkspaceRoot = useOpenWorkspaceRoot()

  useValidateRootFolder()
  useWorkspaceEvents(rootFolder)

  const handlePick = (entry: PickedFsEntry) => {
    void openPickedWorkspaceRoot(entry, openWorkspaceRoot)
  }
  const picker = usePickEntry({
    mode: 'folder',
    onOpenChange: setPickerOpen,
    onPick: handlePick,
    open: pickerOpen && !chooseMachine,
    value: rootFolder,
  })

  if (!rootFolder && restoringWorkspace) {
    return (
      <LoadingState label='Restoring workspace' className='flex h-full flex-col gap-3 p-6'>
        <div className='skeleton-sweep h-4 w-48 rounded-md' />
        <div className='skeleton-sweep h-4 w-32 rounded-md' />
      </LoadingState>
    )
  }

  return (
    <>
      <div className='flex h-full min-h-0 flex-col'>
        {rootFolder ? (
          <WorkspaceView rootFolder={rootFolder} />
        ) : (
          <EmptyWorkspace onChooseFolder={openPicker} />
        )}
      </div>
      {picker}
      {pickerOpen && chooseMachine ? (
        <ProjectPicker machines={machines} onClose={() => setPickerOpen(false)} />
      ) : null}
    </>
  )
}

async function openPickedWorkspaceRoot(
  entry: PickedFsEntry,
  openWorkspaceRoot: ReturnType<typeof useOpenWorkspaceRoot>,
) {
  const result = await openWorkspaceRoot(entry.path)
  if (result !== 'opened' && result !== 'already-open') return

  log.info({
    action: 'workspace.root_selected',
    area: 'workspace',
    entryType: entry.type,
    path: entry.path,
  })
}
