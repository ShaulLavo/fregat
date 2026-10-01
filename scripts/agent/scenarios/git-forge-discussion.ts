import { ok } from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { committedFixture, fixtureGit } from '../fixture-workspace'
import { createFakeForge } from '../fake-forge'
import { selectors } from '../selectors'
import { isolatedNativeScenario } from './native-provider-verification'

let forge: Awaited<ReturnType<typeof createFakeForge>> | null = null

export const gitForgeDiscussion = isolatedNativeScenario({
  name: 'git-forge-discussion',
  description:
    'Open forge discussion from the session branch header, post a comment, refresh an external comment, preserve a refused draft, submit approval, and keep a refused review summary.',
  fixture: new URL('../fixtures/native-checkpoint.mjs', import.meta.url),
  async prepareWorktree() {
    const fixture = await committedFixture('forge-discussion')
    await fixtureGit(fixture.path, ['remote', 'add', 'origin', 'git@github.com:fregat/fixture.git'])
    return fixture
  },
  async prepareServer() {
    forge = await createFakeForge({
      number: 7,
      title: 'Review fixture',
      url: 'https://github.com/fregat/fixture/pull/7',
      state: 'OPEN',
      isDraft: false,
      closedAt: null,
    })
    const statePath = join(forge.directory, 'forge.json')
    const state = JSON.parse(await readFile(statePath, 'utf8'))
    state.activityReviews = [
      {
        id: 1,
        body: 'Native activity review',
        state: 'CHANGES_REQUESTED',
        user: { login: 'alice' },
        submitted_at: '2026-10-01T10:00:00Z',
      },
    ]
    state.activityCommits = [
      {
        sha: 'a'.repeat(40),
        author: { login: 'bob' },
        commit: {
          message: 'Native activity commit',
          author: { name: 'Git author' },
          committer: { date: '2026-10-01T09:00:00Z' },
        },
      },
    ]
    state.activityDiscussions = [
      {
        id: 9,
        body: 'Native inline root',
        path: 'src/main.ts',
        user: { login: 'alice' },
        created_at: '2026-10-01T10:00:00Z',
        html_url: 'https://github.com/fregat/fixture/pull/7#9',
      },
      {
        id: 10,
        in_reply_to_id: 9,
        body: 'Native inline reply',
        path: 'src/main.ts',
        user: { login: 'bob' },
        created_at: '2026-10-01T11:00:00Z',
        html_url: 'https://github.com/fregat/fixture/pull/7#10',
      },
    ]
    await writeFile(statePath, JSON.stringify(state))
    return { pathPrefix: forge.directory }
  },
  async drive(page, { step }) {
    ok(forge)
    try {
      await selectors.buttonNamed(page, 'Discussion').click()
      await selectors.forgeComment(page).waitFor()
      await step('discussion-empty')
      await selectors.forgeActivityTab(page).click()
      await selectors.forgeCommentText(page, 'Native activity review').waitFor()
      await selectors.forgeCommentText(page, 'Native activity commit').waitFor()
      await selectors.forgeCommentText(page, 'Native inline reply').scrollIntoViewIfNeeded()
      await step('activity-discussion-grouped')
      await selectors.forgeCommentsTab(page).click()
      await selectors.forgeComment(page).fill('Please add a regression test.')
      await selectors.buttonNamed(page, 'Post comment').click()
      await selectors.forgeCommentText(page, 'Please add a regression test.').waitFor()
      await step('comment-posted')
      const statePath = join(forge.directory, 'forge.json')
      const state = JSON.parse(await readFile(statePath, 'utf8'))
      ok(state.comments.length === 1 && state.comments[0].body === 'Please add a regression test.')
      state.comments.push({ ...state.comments[0], id: 2, body: 'External follow-up' })
      await writeFile(statePath, JSON.stringify(state))
      await selectors.buttonNamed(page, 'Refresh discussion').click()
      await selectors.forgeCommentText(page, 'External follow-up').waitFor()
      await step('external-comment-refreshed')
      state.failComment = true
      await writeFile(statePath, JSON.stringify(state))
      await selectors.forgeComment(page).fill('Keep this draft')
      await selectors.buttonNamed(page, 'Post comment').click()
      await selectors.forgeCommentText(page, 'The Git host could not post the comment').waitFor()
      ok((await selectors.forgeComment(page).inputValue()) === 'Keep this draft')
      await step('refused-draft-kept')
      await selectors.forgeReviewSummary(page).fill('Reviewed the regression coverage.')
      await selectors.buttonNamed(page, 'Approve pull request').click()
      await selectors.forgeCommentText(page, 'Review submitted').waitFor()
      const reviewed = JSON.parse(await readFile(statePath, 'utf8'))
      ok(reviewed.reviews.length === 1 && reviewed.reviews[0].event === 'APPROVE')
      ok(reviewed.reviews[0].body === 'Reviewed the regression coverage.')
      await step('review-approved')
      await selectors.forgeActivityTab(page).click()
      await selectors.forgeCommentText(page, 'Reviewed the regression coverage.').waitFor()
      await step('review-activity-settled')
      await selectors.forgeCommentsTab(page).click()
      reviewed.failReview = true
      await writeFile(statePath, JSON.stringify(reviewed))
      await selectors.forgeReviewSummary(page).fill('Please revise the edge case.')
      await selectors.buttonNamed(page, 'Request changes').click()
      await selectors.forgeCommentText(page, 'The Git host could not submit the review').waitFor()
      ok((await selectors.forgeReviewSummary(page).inputValue()) === 'Please revise the edge case.')
      await step('refused-review-kept')
      await page.keyboard.press('Escape')
      await selectors.forgeDiscussion(page).waitFor({ state: 'hidden' })
      await selectors.buttonNamed(page, 'Discussion').click()
      await selectors.forgeReviewSummary(page).waitFor()
      ok((await selectors.forgeReviewSummary(page).inputValue()) === 'Please revise the edge case.')
      ok((await selectors.forgeComment(page).inputValue()) === 'Keep this draft')
      await step('review-draft-reopened')
      const final = JSON.parse(await readFile(statePath, 'utf8'))
      ok(final.reviews.length === 1)
      const previewBody = 'Full viewport context '.repeat(300).trim()
      final.comments.push({ ...final.comments[0], id: 3, body: previewBody })
      await writeFile(statePath, JSON.stringify(final))
      await selectors.buttonNamed(page, 'Refresh discussion').click()
      await selectors.forgeCommentText(page, previewBody).waitFor()
      await page.setViewportSize({ width: 1024, height: 768 })
      await step('short-viewport-review-actions')
      const bounds = await selectors.forgeDiscussion(page).boundingBox()
      ok(
        bounds && bounds.y >= 0 && bounds.y + bounds.height <= 768,
        'discussion popup stays inside the short viewport',
      )
      await selectors.buttonNamed(page, 'Request changes').scrollIntoViewIfNeeded()
      for (const name of [
        'Post comment',
        'Submit review',
        'Approve pull request',
        'Request changes',
      ]) {
        const action = await selectors.buttonNamed(page, name).boundingBox()
        ok(
          action && action.y >= 0 && action.y + action.height <= 768,
          `${name} is reachable inside the short viewport`,
        )
        await selectors.buttonNamed(page, name).click({ trial: true })
      }
      await step('short-viewport-actions-reachable')
      const calls = await forge.calls()
      ok(calls.filter((call) => call.includes('POST')).length === 4)
      ok(calls.some((call) => call.some((arg) => arg.includes('/pulls/7/comments?'))))
      ok(calls.some((call) => call.some((arg) => arg.includes('/pulls/7/commits?'))))
      ok(calls.some((call) => call.some((arg) => arg.includes('/pulls/7/reviews?'))))
    } finally {
      await forge.release()
      forge = null
    }
  },
})
