import { MockProviderAdapter, runGit } from 'server/testing'
import { test, expect } from '../../../test/fixtures'
import { makeTestServer } from '../../../test/server'
import { createInProcessClient } from '../../../test/client'
import { prepareGitWorkbench } from '../../../test/factories/git-workbench'
import { createGitWorkbench } from '@/git/state/workbench'

test('generated commit message uses the provider route and leaves changes uncommitted', async () => {
  const providerAdapter = new MockProviderAdapter({
    auth: { status: 'authenticated', type: 'api-key' },
    models: [
      {
        name: 'Claude Haiku',
        shortName: 'Haiku',
        slug: 'claude-haiku-test',
        capabilities: null,
        isCustom: false,
      },
    ],
    responseText: 'Describe the fixture change',
  })
  const server = await makeTestServer({ providerAdapter })
  const store = createGitWorkbench(createInProcessClient(server), '')
  try {
    await prepareGitWorkbench(server.root)
    expect(await store.generateMessage(), store.getSnapshot().message).toBe(
      'Describe the fixture change',
    )
    expect((await runGit(server.root, ['log', '-1', '--format=%s'])).stdout).toContain(
      'Initial fixture',
    )
    expect(store.getSnapshot().busy).toBe(false)
  } finally {
    store.dispose()
    await server.cleanup()
  }
})
