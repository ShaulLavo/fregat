import { allEditorTabs } from '@/lib/documents/utils/groups'
import {
  renderAddressHarness,
  seedWorkspaceCache,
  waitForNavigation,
} from '../../../../test/address'
import { navigationWorkspace } from '../../../../test/factories/navigation-workspace'
import { expect, test } from '../../../../test/fixtures'

for (const cached of [false, true]) {
  for (const legacy of [false, true]) {
    test(`checkpoint URL boot preserves file and history siblings with cached=${cached}, legacy=${legacy}`, async ({
      client,
      server,
    }) => {
      const workspace = await navigationWorkspace(client, server)
      const prior = seedWorkspaceCache({
        ...workspace,
        tabPaths: cached ? ['repo/a.ts', `history:${encodeURIComponent('repo/b.ts')}`] : [],
      })
      const original = allEditorTabs(prior.editorGroups)
      const tokens = [
        'f/a.ts',
        'h/b.ts',
        ...(legacy ? ['k/f0000000-0000-4000-8000-000000000001/0..1/a.ts'] : []),
      ]
      const { harness, navigation } = await renderAddressHarness({
        initialEntries: [`${workspace.base}/f/a.ts?tabs=${tokens.join('~')}`],
      })
      await waitForNavigation(navigation)
      const panels = harness.workspace.getState().workbenchPanels
      const tabs = allEditorTabs(panels.editorGroups)
      expect(
        tabs.map((tab) => tab.content.kind === 'document' && tab.content.document.kind),
      ).toEqual(['file', 'history'])
      expect(new Set(tabs.map((tab) => tab.id)).size).toBe(2)
      expect(harness.workspace.getState().selectedTabContent).toEqual(tabs[0]?.content)
      if (!cached) return
      expect(tabs.map((tab) => tab.id)).toEqual(original.map((tab) => tab.id))
      expect(panels.gitHistory).toEqual(prior.gitHistory)
      expect(panels.terminalTabs).toEqual(prior.terminalTabs)
    })
  }
}
