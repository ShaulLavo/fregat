import { onTestFinished } from 'vitest'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { expect } from '../fixtures'
import { renderApplication } from '../render'
import { waitForNavigation } from '../address'
import { createAddressTestRuntime } from './address-runtime'
import { makeSessionDomainFixture } from './session-domain'
import { createObservedInProcessClient } from '../client'

export async function createChatNavigationFixture({
  beforeRequest,
}: {
  readonly beforeRequest?: (request: Request) => void | Promise<void>
} = {}) {
  const domain = await makeSessionDomainFixture()
  const registration = (await domain.register()).result
  if (!registration) return expect.unreachable('chat project registration is missing')
  const client = beforeRequest
    ? createObservedInProcessClient(domain.server, beforeRequest)
    : domain.client
  const { application, editor, environmentId } = await createAddressTestRuntime(client)
  const refresh = async () => {
    const snapshot = await domain.snapshot()
    useChatProjectionStore.getState().syncShellSnapshot(environmentId, snapshot)
    return snapshot
  }
  await refresh()
  const rendered = renderApplication(null, application)
  onTestFinished(async () => {
    rendered.unmount()
    application.dispose()
    await domain.server.cleanup()
  })
  await waitForNavigation(rendered.navigation)
  return {
    domain,
    application,
    editor,
    environmentId,
    navigation: rendered.navigation,
    registration,
    refresh,
  }
}
