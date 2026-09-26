import { CaretDownIcon, CaretUpIcon } from '@phosphor-icons/react'
import type { GitFileStatus } from '@workspace/contracts'

import type { ScreenProps } from '@/features/phone/utils/screen-query'
import { useEditorConflictState } from '@/features/editor/state/conflict-state'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { useStatus } from '@/features/git/hooks/use-status'
import { EditorGroup } from '@/features/workbench/components/editor-group'
import { EditorGroupsDragProvider } from '@/features/workbench/providers/editor-groups-drag-provider'
import { Header } from '@/features/phone/components/header'
import { HeaderButton } from '@/features/phone/components/header-button'
import { useScopeFiles } from '@/features/phone/hooks/use-scope-files'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { activeEditorGroup } from '@/lib/documents/utils/groups'
import { tabLabel, tabTitle } from '@/lib/documents/utils/labels'

const NO_GIT_FILES: readonly GitFileStatus[] = []

/** One file or diff in the active editor group; a diff steps through the files of its scope. */
export function FileScreen({ diffScope, rootPath }: ScreenProps) {
  const groups = useEditorWorkspaceState((state) => state.workbenchPanels.editorGroups)
  const selected = useEditorWorkspaceState((state) => state.selectedTabContent)
  const conflicts = useEditorConflictState((state) => state.conflicts)
  const gitFiles = useStatus(rootPath).data?.files ?? NO_GIT_FILES
  const scope = useScopeFiles(diffScope)

  return (
    <section aria-label='File' className='flex h-full min-h-0 flex-col'>
      <EditorGroupsDragProvider key={rootPath}>
        <EditorGroup
          active
          bar={(titleActions) => (
            <Header
              actions={
                <>
                  {titleActions}
                  {scope ? (
                    <>
                      <HeaderButton
                        disabled={!scope.previous}
                        icon={CaretUpIcon}
                        label='Previous file'
                        onClick={() => scope.previous?.()}
                      />
                      <HeaderButton
                        disabled={!scope.next}
                        icon={CaretDownIcon}
                        label='Next file'
                        onClick={() => scope.next?.()}
                      />
                    </>
                  ) : null}
                </>
              }
              detail={
                scope ? (
                  <span className='font-mono tabular-nums'>
                    {scope.index + 1} of {scope.count}
                  </span>
                ) : null
              }
              fullTitle={selected ? tabTitle(selected) : undefined}
              title={selected ? tabLabel(selected) : 'No file open'}
            />
          )}
          conflicts={conflicts}
          gitFiles={gitFiles}
          group={activeEditorGroup(groups)}
          rootPath={filesystemPath(rootPath)}
        />
      </EditorGroupsDragProvider>
    </section>
  )
}
