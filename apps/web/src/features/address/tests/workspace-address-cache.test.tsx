import { confirmedEnvironmentOrigin } from '@/lib/environments/state/domain'
import { queryClientFor } from '@/lib/environments/state/query-clients'
import { fileSystemKeys } from '@/lib/query-keys'
import { expect, test } from '../../../../test/fixtures'
import { createChatNavigationFixture } from '../../../../test/factories/chat-navigation'
import { AMBIGUOUS_SESSION, DOMAIN_SESSION } from '../../../../test/factories/session-domain'

test('switching between chats in one worktree registers its address once', async () => {
  const { domain, environmentId, navigation, registration, refresh } =
    await createChatNavigationFixture()
  await domain.createSession(registration.worktreeId, DOMAIN_SESSION)
  await domain.createSession(registration.worktreeId, AMBIGUOUS_SESSION)
  await refresh()

  await navigation.openChat({ environmentId, sessionId: DOMAIN_SESSION, surface: 'main' })
  await navigation.openChat({ environmentId, sessionId: AMBIGUOUS_SESSION, surface: 'main' })
  await navigation.openChat({ environmentId, sessionId: DOMAIN_SESSION, surface: 'main' })

  const cache = queryClientFor(confirmedEnvironmentOrigin(environmentId)).getQueryCache()
  const addresses = cache.findAll({ queryKey: [...fileSystemKeys.all, 'workspace-address'] })
  expect(addresses).toHaveLength(1)
  expect(addresses[0]?.state.dataUpdateCount).toBe(1)
})
