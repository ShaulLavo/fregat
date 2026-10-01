import { runInNewContext } from 'node:vm'
import type { Page } from 'playwright'
import { expect, test } from 'vitest'
import { waitForSessionWorkspace } from './selectors'

const root = 'tmp/fixture-workspace'
const sessionId = 'fixture-session'
const environmentId = 'fixture-environment'

test.for([
  { path: '/~fixture.address/chat/t/fixture-session', owner: 'other-environment', accepted: false },
  { path: '/~fixture.address/chat/t/fixture-session', owner: environmentId, accepted: true },
  {
    path: '/@fixture-environment/~fixture.address/chat/t/fixture-session',
    owner: 'other-environment',
    accepted: false,
  },
])(
  'workspace readiness matches the independently resolved environment: $path / $owner',
  async ({ path, owner, accepted }) => {
    let observed: unknown
    // Execute the actual Playwright predicate; control only its browser document and URL.
    const page = {
      waitForFunction: async (predicate: (argument: unknown) => unknown, argument: unknown) => {
        observed = runInNewContext(`(${predicate.toString()})(argument)`, {
          argument,
          location: { pathname: path },
          document: {
            querySelector: (selector: string) => {
              if (selector === '[aria-label="Switch project"]') {
                return { getAttribute: () => `${root} · fixture` }
              }
              if (selector === '[data-testid="chat-input-editor"]') {
                return {
                  __lexicalEditor: {
                    _config: { namespace: `platform-chat-input:${owner}:${root}:${sessionId}` },
                  },
                }
              }
              return null
            },
          },
        })
      },
    } as unknown as Page
    await waitForSessionWorkspace(page, sessionId, root, environmentId)
    expect(observed).toBe(accepted)
  },
)
