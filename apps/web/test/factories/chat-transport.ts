import { QueryClient, QueryObserver } from '@tanstack/query-core'
import type { OrchestrationSessionDetailPage } from '@workspace/contracts'
import { TEST_ENVIRONMENT_ID } from './chat'
import type { ChatTransport } from '@/features/chat/transport/chat-transport'
import { createClientError } from '@workspace/client-core/errors'

/**
 * A `ChatTransport` where every seam refuses loudly, for tests that exercise
 * one of them. Overriding only what a test drives keeps the refusal as the
 * assertion: a call the test did not intend fails with the method's name rather
 * than returning a plausible empty value and passing for the wrong reason.
 *
 * It also means adding a transport method does not need an edit in every test
 * that happens to build an transport.
 */
export function unsupportedChatTransport(overrides: Partial<ChatTransport> = {}): ChatTransport {
  const earlier = new QueryObserver<OrchestrationSessionDetailPage>(new QueryClient(), {
    queryKey: ['test', 'earlier'],
    enabled: false,
  })
  return {
    environmentId: TEST_ENVIRONMENT_ID,
    closed: false,
    close: () => unsupported('close'),
    retainSessionDetail: () => unsupported('retainSessionDetail'),
    loadEarlierPage: () => unsupported('loadEarlierPage'),
    earlierPageObserver: () => earlier,
    dispatchCommand: () => unsupported('dispatchCommand'),
    replayEvents: () => unsupported('replayEvents'),
    shellStream: () => unsupportedStream('shellStream'),
    sessionDetailPage: () => unsupported('sessionDetailPage'),
    sessionDetailSnapshot: () => unsupported('sessionDetailSnapshot'),
    sessionDetailStream: () => unsupportedStream('sessionDetailStream'),
    ...overrides,
  }
}

function unsupported(method: string): never {
  throw createClientError({
    code: 'TEST_UNSUPPORTED',
    message: `${method} is not wired for this test.`,
    status: 500,
    why: 'The test built a chat transport without implementing this seam.',
    fix: `Pass a ${method} override to unsupportedChatTransport.`,
  })
}

async function* unsupportedStream(method: string) {
  unsupported(method)
  // Unreachable: `unsupported` is typed `never`. Present so the generator's
  // yield type is inferred rather than `undefined`.
  yield unsupported(method)
}
