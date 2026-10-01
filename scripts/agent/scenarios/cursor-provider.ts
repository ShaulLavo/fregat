import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { selectors } from '../selectors'
import { isolatedNativeScenario, sendPrompt } from './native-provider-verification'

export const cursorProvider = isolatedNativeScenario({
  name: 'cursor-provider',
  providerKind: 'cursor',
  description:
    'An isolated Cursor ACP executable answers through the real chat and native permission flow.',
  fixture: new URL('../fixtures/fake-acp.mjs', import.meta.url),
  async drive(page, { step, root }) {
    await selectors.composerModes(page).click()
    await selectors.composerAskFirst(page).click()
    await selectors.composerAskFirst(page).press('Escape')
    await selectors.composerAskFirst(page).waitFor({ state: 'hidden' })
    await sendPrompt(page, 'hello')
    await selectors.chatContainingText(page, 'fixture:hello:').waitFor({ timeout: 30_000 })
    await step('cursor-native-answer')
    await sendPrompt(page, 'permission')
    await selectors.genericApproval(page).waitFor({ timeout: 30_000 })
    await step('cursor-native-permission')
    await selectors.genericApprovalDecision(page, 'Allow once').click()
    await selectors.genericApproval(page).waitFor({ state: 'hidden', timeout: 30_000 })
    await sendPrompt(page, 'after-permission')
    await selectors
      .chatContainingText(page, 'fixture:after-permission:')
      .waitFor({ timeout: 30_000 })
    await step('cursor-native-permission-settled')
    const records = (await readFile(join(root, 'native.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    const spawn = records.find((entry) => entry.event === 'spawn')
    ok(spawn, 'Native Cursor executable started')
    strictEqual(spawn.args.at(-1), 'acp')
    strictEqual(spawn.profile, join(root, 'config'))
    ok(
      records.some(
        (entry) => entry.method === 'authenticate' && entry.params.methodId === 'fixture-login',
      ),
      'Native auth selects an advertised method',
    )
    ok(
      records.some((entry) => entry.method === 'session/prompt'),
      'Composer reaches native ACP prompt',
    )
    deepStrictEqual(
      records.find((entry) => entry.id === 'permission-1')?.result,
      { outcome: { outcome: 'selected', optionId: 'yes' } },
      'The visible permission decision reaches the native executable exactly once',
    )
    strictEqual(records.filter((entry) => entry.id === 'permission-1').length, 1)
    return {
      nativeRpcMethods: records.filter((entry) => entry.method).map((entry) => entry.method),
      liveAccountSmoke: 'untested',
    }
  },
})
