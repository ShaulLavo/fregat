import type { Page } from 'playwright'
import { createGitFixture, fixtureGit } from '../fixture-workspace'
import { openChat, openScenarioSession, removeScenarioSessions } from './chat-verification'
import {
  registerFixtureProject,
  withFixtureProvider,
  type FixtureProviderKind,
  type NativeProvider,
} from './native-provider-verification'

export type FixtureRepository = {
  readonly orchestration: string
  readonly native: NativeProvider
  readonly fixture: string
  readonly worktreeId: string
  /** Every session listed here is stopped and deleted afterwards. */
  readonly sessions: string[]
  /** Starts a full-access session on the fixture provider, titled `${title} <id>`, and opens it. */
  readonly openSession: (title: string) => Promise<string>
}

/**
 * A fixture provider of `kind` and a disposable repository registered as its own project. The
 * body's sessions, the project, the repository and the provider are removed afterwards; a
 * failure screenshots the page before cleanup changes it.
 */
export async function runInFixtureRepository(
  page: Page,
  step: (label: string) => Promise<void>,
  input: {
    readonly kind: FixtureProviderKind
    readonly name: string
    /** Writes into the repository before its first commit. */
    readonly prepare?: (fixture: string, native: NativeProvider) => Promise<void>
  },
  body: (repository: FixtureRepository) => Promise<void>,
) {
  const orchestration = await openChat(page)
  await withFixtureProvider(page, orchestration, input, async (native) => {
    const fixture = await createGitFixture(input.name)
    const sessions: string[] = []
    let projectId: string | null = null
    try {
      await input.prepare?.(fixture, native)
      await fixtureGit(fixture, ['add', '.'])
      // A project needs a root commit for its repository identity.
      await fixtureGit(fixture, ['commit', '--quiet', '--allow-empty', '-m', 'initial'])
      const worktree = await registerFixtureProject(page, orchestration, fixture)
      projectId = worktree.projectId
      const openSession = async (title: string) => {
        const sessionId = crypto.randomUUID()
        sessions.push(sessionId)
        await openScenarioSession(page, orchestration, {
          model: native.model,
          sessionId,
          title: `${title} ${sessionId.slice(0, 8)}`,
          worktreeId: worktree.id,
        })
        return sessionId
      }
      await body({ orchestration, native, fixture, worktreeId: worktree.id, sessions, openSession })
    } catch (error) {
      await step('failed-before-cleanup')
      throw error
    } finally {
      await removeScenarioSessions(page, orchestration, { fixture, projectId, sessions })
    }
  })
}
