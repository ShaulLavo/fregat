import { waitFor } from '@testing-library/react'

import { parseAddress } from '@workspace/client-core/address/grammar'
import { expect, test } from '../../../../test/fixtures'
import {
  pressBack,
  recordHistoryWrites,
  renderAddressHarness,
  seedWorkspaceCache,
  waitForNavigation,
} from '../../../../test/address'
import { createTestNavigation } from '../../../../test/factories/navigation'
import { navigationWorkspace } from '../../../../test/factories/navigation-workspace'

for (const extra of ['', '&probe=goto']) {
  test(`canonical boot settles and retains history state with query suffix ${extra || 'control'}`, async ({
    client,
    server,
  }) => {
    const workspace = await navigationWorkspace(client, server)
    seedWorkspaceCache(workspace)
    const href = `${workspace.base}?tabs=-&side=git&log.find=keep&editorPerfTrace=1${extra}`
    const navigation = createTestNavigation({
      initialEntries: [`${workspace.base}/f/a.ts`, href],
    })
    const history = navigation.router.history
    history.replace(href, { saved: { values: ['retained'] } })
    const index = history.location.state.__TSR_index
    const length = history.length
    const writes = recordHistoryWrites(navigation)
    let loads = 0
    const unsubscribe = navigation.router.subscribe('onBeforeNavigate', () => {
      loads += 1
      if (loads === 20) navigation.dispose()
    })
    try {
      await renderAddressHarness({ navigation })
      await waitFor(() => expect(loads).toBeGreaterThan(0))
      expect(loads).toBeLessThan(20)
      await waitForNavigation(navigation)
      expect(navigation.getSnapshot().status).toBe('applied')
      expect(history.location.href).not.toContain('probe=')
      expect(parseAddress(history.location.href)).toMatchObject({
        side: 'git',
        logs: { find: 'keep' },
        passthrough: { editorPerfTrace: '1' },
      })
      expect(history.location.state).toMatchObject({ saved: { values: ['retained'] } })
      expect(history.location.state.__TSR_index).toBe(index)
      expect(history.length).toBe(length)
      expect(writes.pushes).toHaveLength(0)
      expect(writes.replaces.length).toBeLessThanOrEqual(1)

      await pressBack(navigation)
      expect(parseAddress(history.location.href).document).toBe('f/a.ts')
      navigation.forward()
      await waitForNavigation(navigation)
      expect(history.location.state).toMatchObject({ saved: { values: ['retained'] } })
      expect(history.location.state.__TSR_index).toBe(index)
      expect(history.length).toBe(length)
    } finally {
      unsubscribe()
      writes.restore()
      navigation.dispose()
    }
  })
}
