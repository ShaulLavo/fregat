import { execFileSync } from 'node:child_process'
import { ok, strictEqual } from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as v from 'valibot'
import { orchestrationDispatchResultSchema } from '../../../packages/contracts/src/index'
import { selectors } from '../selectors'
import { dispatch, readShell } from './chat-verification'
import {
  isolatedNativeScenario,
  nativeLog,
  settingsSnapshot,
  writeSettings,
} from './native-provider-verification'

export const sessionTitles = isolatedNativeScenario({
  name: 'session-titles',
  description:
    'Generate and regenerate titles through an isolated native provider; preserve manual rename against a delayed result, reload, fail visibly and retry.',
  fixture: new URL('../fixtures/native-titles.mjs', import.meta.url),
  async drive(page, { step, root, orchestration, providerInstanceId }) {
    const base = orchestration.replace(/\/orchestration$/, '')
    const before = await settingsSnapshot(page, base)
    const hadOverride =
      before.layers.find((layer) => layer.id === 'user')?.raw[
        'chat.projectTextGenerationModels'
      ] !== undefined
    const sessionId = crypto.randomUUID()
    const prefix = `Title ${sessionId.slice(0, 8)}`
    const seed = `${prefix} explain queue retries`
    let title = `${prefix} initial`
    const control = (mode: 'success' | 'hold' | 'invalid', value: string) =>
      writeFile(join(root, 'title-control.json'), JSON.stringify({ mode, title: value }))
    const current = async () =>
      (await readShell(page, orchestration)).sessions.find((session) => session.id === sessionId)
    const waitTitle = async (expected: string) => {
      await page.waitForFunction(
        async ({ orchestration, sessionId, expected }) => {
          const state = await (await fetch(`${orchestration}/shell-snapshot`)).json()
          return state.sessions.some(
            (session: { id: string; title: string }) =>
              session.id === sessionId && session.title === expected,
          )
        },
        { orchestration, sessionId, expected },
      )
      await selectors.sessionByTitle(page, expected).waitFor()
    }
    const action = async (name: string) => {
      await selectors.sessionByTitle(page, title).click({ button: 'right' })
      await selectors.sessionLifecycleAction(page, name).click()
    }
    let created = false
    let projectId: string | undefined
    try {
      const workspaceRoot = join(root, 'title-project')
      await mkdir(workspaceRoot)
      execFileSync('git', ['init', workspaceRoot], { stdio: 'ignore' })
      execFileSync(
        'git',
        ['remote', 'add', 'origin', `https://example.com/title-fixture/${sessionId}.git`],
        { cwd: workspaceRoot, stdio: 'ignore' },
      )
      const response = await page.request.post(`${orchestration}/commands`, {
        headers: { Origin: new URL(page.url()).origin },
        data: {
          type: 'project.create',
          commandId: `title-project-${crypto.randomUUID()}`,
          title: prefix,
          workspaceRoot,
        },
      })
      ok(response.ok(), 'Create isolated title project')
      const registration = v.parse(orchestrationDispatchResultSchema, await response.json()).result
      ok(registration, 'Title project registration returns its identity')
      projectId = registration.projectId
      const worktreeId = registration.worktreeId
      await writeSettings(page, base, [
        {
          kind: 'set',
          key: 'chat.projectTextGenerationModels',
          value: {
            ...before.values['chat.projectTextGenerationModels'],
            [projectId]: { providerInstanceId, model: 'gpt-5.5' },
          },
        },
      ])
      await control('success', title)
      await dispatch(page, orchestration, {
        type: 'session.create',
        sessionId,
        title: seed,
        worktreeTarget: { kind: 'current', worktreeId },
        modelSelection: { providerInstanceId, model: 'gpt-5.5' },
      })
      created = true
      await selectors.sessionSearch(page).fill(seed)
      await selectors.sessionByTitle(page, seed).click()
      await page.waitForURL((url) => url.href.includes(sessionId))
      await step('isolated-title-session-ready')
      await selectors.chatMessage(page).fill(seed)
      await selectors.chatSend(page).click()
      await selectors.sessionSearch(page).fill('')
      await waitTitle(title)
      strictEqual((await current())?.titleState?.source, 'generated')
      await step('initial-title-generated')
      const regenerated = `${prefix} regenerated`
      await control('success', regenerated)
      await action('Regenerate title')
      title = regenerated
      await waitTitle(title)
      await step('regenerated-title')
      await control('hold', `${prefix} stale result`)
      await action('Regenerate title')
      await selectors.titleGenerationStatus(page).waitFor()
      await step('pending-title-generation')
      const nativeBefore = await nativeLog(root)
      const held = nativeBefore.findLast((entry) => entry.event === 'title-request')
      await action('Rename')
      const manual = `${prefix} manual wins`
      await selectors.sessionTitleInput(page).fill(manual)
      await selectors.sessionTitleInput(page).press('Enter')
      title = manual
      await waitTitle(title)
      await control('success', `${prefix} stale result`)
      let finished = false
      for (let attempt = 0; attempt < 100; attempt++) {
        const entries = await nativeLog(root)
        if (
          entries.some((entry) => entry.event === 'title-turn-completed' && entry.pid === held?.pid)
        ) {
          finished = true
          break
        }
        await Bun.sleep(50)
      }
      ok(finished, 'Delayed native title response completes')
      await page.reload()
      await selectors.sessionSearch(page).fill(prefix)
      await waitTitle(title)
      strictEqual((await current())?.titleState?.source, 'manual')
      await step('manual-title-survives-late-result-and-reload')
      await control('invalid', '')
      await action('Regenerate title')
      await selectors.titleGenerationFailure(page).waitFor()
      ok((await current())?.titleGenerationError)
      await step('title-failure-visible')
      const retried = `${prefix} retried`
      await control('success', retried)
      await action('Retry title generation')
      title = retried
      await waitTitle(title)
      strictEqual((await current())?.titleGenerationError, null)
      await step('title-retry-succeeds')
    } finally {
      if (created)
        await dispatch(page, orchestration, {
          type: 'session.delete',
          sessionId,
        })
      const currentSettings = await settingsSnapshot(page, base)
      const overrides = {
        ...currentSettings.values['chat.projectTextGenerationModels'],
      }
      if (projectId) delete overrides[projectId]
      const reset =
        !hadOverride &&
        JSON.stringify(overrides) ===
          JSON.stringify(before.values['chat.projectTextGenerationModels'])
      if (projectId) await dispatch(page, orchestration, { type: 'project.delete', projectId })
      await writeSettings(page, base, [
        reset
          ? { kind: 'reset', keys: ['chat.projectTextGenerationModels'] }
          : {
              kind: 'set',
              key: 'chat.projectTextGenerationModels',
              value: overrides,
            },
      ])
    }
  },
})
