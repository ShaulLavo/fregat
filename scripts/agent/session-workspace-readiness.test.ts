import { runInNewContext } from 'node:vm'
import type { Page } from 'playwright'
import { expect, test } from 'vitest'
import { waitForSessionWorkspace } from './selectors'

const root = 'tmp/fixture-workspace'
const sessionId = 'fixture-session'
const environmentId = 'fixture-environment'

test.for([
  {
    path: '/~fixture.address/chat/t/fixture-session',
    owner: 'other-environment',
    shell: 'desktop',
    switcher: true,
    accepted: false,
  },
  {
    path: '/~fixture.address/chat/t/fixture-session',
    owner: environmentId,
    shell: 'desktop',
    switcher: true,
    accepted: true,
  },
  {
    path: '/@fixture-environment/~fixture.address/chat/t/fixture-session',
    owner: 'other-environment',
    shell: 'desktop',
    switcher: true,
    accepted: false,
  },
  {
    path: '/~fixture.address/chat/t/fixture-session',
    owner: environmentId,
    shell: 'phone',
    switcher: false,
    accepted: true,
  },
  {
    path: '/~fixture.address/chat/t/fixture-session',
    owner: 'other-environment',
    shell: 'phone',
    switcher: false,
    accepted: false,
  },
  {
    path: '/~fixture.address/chat/t/fixture-session',
    owner: environmentId,
    shell: 'desktop',
    switcher: false,
    accepted: false,
  },
])(
  'workspace readiness matches the independently resolved environment: $path / $owner / $shell / switcher=$switcher',
  async ({ path, owner, shell, switcher, accepted }) => {
    let observed: unknown
    // Execute the actual Playwright predicate; control only its browser document and URL.
    const page = {
      waitForFunction: async (predicate: (argument: unknown) => unknown, argument: unknown) => {
        observed = runInNewContext(`(${predicate.toString()})(argument)`, {
          argument,
          location: { pathname: path },
          document: {
            documentElement: { dataset: { shell } },
            querySelector: (selector: string) => {
              if (selector === '[aria-label="Switch project"]' && switcher) {
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
