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
    'Open forge discussion from the session branch header, post a comment, refresh an external comment, and preserve a refused draft.',
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
    return { pathPrefix: forge.directory }
  },
  async drive(page, { step }) {
    ok(forge)
    try {
      await selectors.buttonNamed(page, 'Discussion').click()
      await selectors.forgeComment(page).waitFor()
      await step('discussion-empty')
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
      const calls = await forge.calls()
      ok(calls.filter((call) => call.includes('POST')).length === 2)
      await step('refused-draft-kept')
    } finally {
      await forge.release()
      forge = null
    }
  },
})
