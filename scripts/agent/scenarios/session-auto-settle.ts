import { committedFixture } from '../fixture-workspace'
import { createFakeForge } from '../fake-forge'
import { selectors } from '../selectors'
import { readShell } from './chat-verification'
import { isolatedNativeScenario } from './native-provider-verification'
import { createScriptError } from '../../structured-errors'

let forge: Awaited<ReturnType<typeof createFakeForge>> | null = null

export const sessionAutoSettle = isolatedNativeScenario({
  name: 'session-auto-settle',
  description:
    'A session in its own worktree whose pull request the forge reports merged after the session began: the server settles it and the rail moves it to Settled.',
  fixture: new URL('../fixtures/native-checkpoint.mjs', import.meta.url),
  prepareWorktree: () => committedFixture('auto-settle'),
  newWorktree: true,
  async prepareServer() {
    forge = await createFakeForge({
      number: 21,
      title: 'Merged change',
      url: 'https://github.com/fregat/fixture/pull/21',
      state: 'MERGED',
      isDraft: false,
      // After the session is created, so the merge answers its request.
      closedAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    })
    return { pathPrefix: forge.directory }
  },
  async drive(page, { step, orchestration, sessionId }) {
    if (!forge) throw createScriptError('The fake forge was not prepared')
    try {
      const session = (await readShell(page, orchestration)).sessions.find(
        (item) => item.id === sessionId,
      )
      if (!session) throw createScriptError('The session is missing from the shell')
      await selectors.sessionSearch(page).fill('')
      await selectors.sessionInShelf(page, session.title, 'Settled').waitFor({ timeout: 20_000 })
      const settled = (await readShell(page, orchestration)).sessions.find(
        (item) => item.id === sessionId,
      )
      if (settled?.settledAt !== session.createdAt)
        throw createScriptError(
          `Settled at ${settled?.settledAt}, not at the session's last activity`,
        )
      await step('settled-by-merge')
    } finally {
      await forge.release()
      forge = null
    }
  },
})
