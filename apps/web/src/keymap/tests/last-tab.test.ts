import { createDefaultWorkbenchPanels } from '@/features/workbench/utils/panels'
import { activeEditorGroup } from '@/lib/documents/utils/groups'
import { tabId } from '@/lib/documents/utils/identity'
import { FocusService } from '@/lib/focus/state/service'
import { selectItemMetadata } from '@workspace/client-core/commands/workspace'
import { createTestCommandRuntime } from '../../../test/factories/command-runtime'
import { createTestQueryClient } from '../../../test/render'
import { expect, test } from '../../../test/fixtures'

test.each([4, 12])('slot 9 selects the last of %i editor tabs', async (count) => {
  const panels = createDefaultWorkbenchPanels()
  const group = activeEditorGroup(panels.editorGroups)
  const tabs = Array.from({ length: count }, (_, index) => ({
    id: tabId(`tab-${index}`),
    content: { kind: 'settings' as const },
  }))
  const selected: string[] = []
  const runtime = createTestCommandRuntime({
    focus: new FocusService(),
    queryClient: createTestQueryClient(),
    options: {
      rootPath: 'repo',
      snapshot: {
        uiMode: 'workbench',
        workbenchPanels: {
          ...panels,
          editorGroups: { root: { ...group, tabs }, activeGroupId: group.id },
        },
      },
      runtime: {
        editor: {
          selectTab: async (target) => {
            selected.push(target.tabId)
            return { status: 'applied' }
          },
        },
      },
    },
  })
  await runtime.bus.dispatch('workspace.selectItem9', {
    source: { kind: 'programmatic', caller: 'test' },
  }).completion
  expect(selected).toEqual([tabs.at(-1)!.id])
})

test('slot 9 imports and exports the VS Code last-editor command', () => {
  expect(selectItemMetadata(9).vscodeCommandIds).toEqual(['workbench.action.lastEditorInGroup'])
})
