import { ok, strictEqual } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'

import { DEFAULT_PROVIDER_INSTANCE_ID } from '../../../packages/contracts/src/index'
import { createFakeForge, type FakePullRequest } from '../fake-forge'
import { committedFixture, fixtureGit } from '../fixture-workspace'
import { selectors } from '../selectors'
import { createScriptError } from '../../structured-errors'
import type { Scenario } from './index'
import { dispatch, openChat, readShell } from './chat-verification'
import { registerFixtureProject } from './native-provider-verification'

type Case = {
  readonly name: string
  readonly worktreeId: string
  /** What the fake forge answers for the branch; `malformed` fails the whole repository. */
  readonly forge: FakePullRequest | 'malformed' | null
  /** The badge's `data-pull-request-state` and hover text, or null for no badge. */
  readonly badge: { readonly state: string; readonly label: string } | null
}

function pullRequest(
  number: number,
  state: FakePullRequest['state'],
  isDraft = false,
): FakePullRequest {
  return {
    number,
    title: `Badge change ${number}`,
    url: `https://github.com/fregat/fixture/pull/${number}`,
    state,
    isDraft,
    closedAt: state === 'OPEN' ? null : '2026-09-25T10:00:00Z',
  }
}

/** Branches are `worktree/<id>`, so the forge's answers can be written before the server starts. */
function plannedCases(): readonly Case[] {
  const planned = [
    {
      name: 'open',
      forge: pullRequest(31, 'OPEN'),
      badge: { state: 'open', label: 'Pull request #31 · Open: Badge change 31' },
    },
    {
      name: 'draft',
      forge: pullRequest(32, 'OPEN', true),
      badge: { state: 'draft', label: 'Pull request #32 · Draft: Badge change 32' },
    },
    {
      name: 'merged',
      forge: pullRequest(33, 'MERGED'),
      badge: { state: 'merged', label: 'Pull request #33 · Merged: Badge change 33' },
    },
    {
      name: 'closed',
      forge: pullRequest(34, 'CLOSED'),
      badge: { state: 'closed', label: 'Pull request #34 · Closed: Badge change 34' },
    },
    { name: 'none', forge: null, badge: null },
    {
      name: 'unknown',
      forge: 'malformed',
      badge: { state: 'unknown', label: 'Pull request unknown. The last lookup failed.' },
    },
  ] as const
  return planned.map((item) => ({ ...item, worktreeId: crypto.randomUUID() }))
}

// The server's PATH is fixed when it starts, so the forge and its answers exist before the drive.
let prepared: {
  forge: Awaited<ReturnType<typeof createFakeForge>>
  cases: readonly Case[]
} | null = null

async function waitForAnswers(page: Page, base: string, cases: readonly Case[]) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const worktrees = (await readShell(page, base)).worktrees
    const settled = cases.every((item) => {
      const status = worktrees.find((worktree) => worktree.id === item.worktreeId)?.pullRequest
        ?.status
      if (item.badge === null) return status === 'none'
      return status === (item.badge.state === 'unknown' ? 'unknown' : 'found')
    })
    if (settled) return
    await Bun.sleep(150)
  }
  throw createScriptError('The server never recorded every worktree pull request')
}

// Project ids follow repository identity, so each fixture needs a remote of its own.
async function linkedFixture(slug: string, repository: string) {
  const fixture = await committedFixture(slug)
  await fixtureGit(fixture.path, [
    'remote',
    'add',
    'origin',
    `https://github.com/fregat/${repository}.git`,
  ])
  return fixture
}

async function railOverflow(page: Page) {
  return selectors
    .sessionRail(page)
    .evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }))
}

export const sessionPullRequestBadge: Scenario = {
  name: 'session-pull-request-badge',
  description:
    'Six sessions, each in its own `worktree/<uuid>` worktree, against a fake gh: open, draft, merged and closed pull requests show distinct rail badges titled with number and title, a branch with none shows nothing, and a repository whose lookup fails shows unknown. Clicking a badge opens its pull request, and the long branch labels never scroll the rail sideways.',
  async prepareServer() {
    const cases = plannedCases()
    const forge = await createFakeForge()
    const branches = Object.fromEntries(
      cases.flatMap((item) => {
        if (item.forge === null) return []
        const answer = item.forge === 'malformed' ? { number: 'malformed' } : item.forge
        return [[`worktree/${item.worktreeId}`, answer]]
      }),
    )
    await writeFile(join(forge.directory, 'forge.json'), JSON.stringify({ branches }))
    prepared = { forge, cases }
    return { pathPrefix: forge.directory }
  },
  async run(page, { step }) {
    if (!prepared) throw createScriptError('The fake forge was not prepared')
    const { forge, cases } = prepared
    const base = await openChat(page)
    const runId = crypto.randomUUID().slice(0, 8)
    const tracked = await linkedFixture('pull-request-badge', 'fixture')
    // A repository of its own: a failed lookup costs every branch asked in the same request.
    const failing = await linkedFixture('pull-request-badge-failing', 'fixture-failing')
    const projects: string[] = []
    const sessions: string[] = []
    try {
      const trackedWorktree = await registerFixtureProject(page, base, tracked.path)
      const failingWorktree = await registerFixtureProject(page, base, failing.path)
      projects.push(trackedWorktree.projectId, failingWorktree.projectId)
      for (const item of cases) {
        const sessionId = crypto.randomUUID()
        const baseWorktreeId = item.forge === 'malformed' ? failingWorktree.id : trackedWorktree.id
        await dispatch(page, base, {
          type: 'session.create',
          sessionId,
          title: `PR badge ${runId} ${item.name}`,
          // No turn runs, so any model will do.
          modelSelection: { providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID, model: 'gpt-5.5' },
          worktreeTarget: { kind: 'new', worktreeId: item.worktreeId, baseWorktreeId },
        })
        sessions.push(sessionId)
      }
      await waitForAnswers(page, base, cases)
      await selectors.sessionSearch(page).fill(`PR badge ${runId}`)
      for (const item of cases) {
        await selectors.sessionRowForWorktree(page, item.worktreeId).waitFor()
        const badge = selectors.sessionPullRequestBadge(page, item.worktreeId)
        if (item.badge === null) {
          strictEqual(await badge.count(), 0, `The ${item.name} row shows no badge`)
          continue
        }
        strictEqual(await badge.getAttribute('data-pull-request-state'), item.badge.state)
        strictEqual(await badge.getAttribute('title'), item.badge.label)
      }
      const chip = selectors.sessionWorktreeChip(page, cases[0]!.worktreeId)
      ok(
        (await chip.getAttribute('title'))?.startsWith(`worktree/${cases[0]!.worktreeId}`),
        'The truncated branch chip recovers its whole branch',
      )
      const overflow = await railOverflow(page)
      ok(
        overflow.scroll <= overflow.client,
        `The rail scrolls sideways: scrollWidth ${overflow.scroll} > clientWidth ${overflow.client}`,
      )
      await step('badges')

      const open = cases[0]!
      await page
        .context()
        .route('https://github.com/**', (route) =>
          route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Stub</title>' }),
        )
      const popup = page.context().waitForEvent('page')
      await selectors.sessionPullRequestBadge(page, open.worktreeId).click()
      const opened = await popup
      await opened.waitForURL('https://github.com/fregat/fixture/pull/31')
      await opened.close()
      ok(
        (await selectors
          .sessionRowForWorktree(page, open.worktreeId)
          .getAttribute('aria-selected')) !== 'true',
        'Opening the pull request leaves the row unselected',
      )
      await step('badge-opened')
    } finally {
      await page.context().unroute('https://github.com/**')
      for (const sessionId of sessions)
        await dispatch(page, base, { type: 'session.delete', sessionId })
      for (const item of cases)
        await dispatch(page, base, { type: 'worktree.release', worktreeId: item.worktreeId }).catch(
          () => {},
        )
      for (const projectId of projects)
        await dispatch(page, base, { type: 'project.delete', projectId, force: true })
      await tracked.release()
      await failing.release()
      await forge.release()
      prepared = null
    }
  },
}
