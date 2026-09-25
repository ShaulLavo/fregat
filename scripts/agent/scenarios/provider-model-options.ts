import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict'
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'
import * as v from 'valibot'
import { selectors, settleAnimations } from '../selectors'
import { dispatch, readShell } from './chat-verification'
import { isolatedNativeScenario, nativeLog } from './native-provider-verification'

const turnOptionsSchema = v.looseObject({
  model: v.string(),
  effort: v.optional(v.string()),
  serviceTier: v.optional(v.string()),
  input: v.array(v.looseObject({ type: v.string(), text: v.optional(v.string()) })),
  collaborationMode: v.looseObject({
    settings: v.looseObject({ model: v.string(), reasoning_effort: v.optional(v.string()) }),
  }),
})

async function chooseOption(page: Page, group: string, choice: string) {
  await selectors.modelOptions(page).click()
  await selectors.modelOptionChoice(page, group, choice).click()
  await selectors.popupMenu(page).waitFor({ state: 'hidden' })
}

async function sendWithOptions(
  page: Page,
  root: string,
  prompt: string,
  expected: { model: string; effort?: string; serviceTier?: string },
) {
  await selectors.chatMessage(page).fill(prompt)
  await selectors.chatSend(page).click()
  await selectors.chatExactText(page, `ACK_${prompt}`).waitFor()
  const entries = (await nativeLog(root)).filter((entry) => entry.event === 'turn/start')
  const matching = entries
    .map((entry) => v.parse(turnOptionsSchema, entry.params))
    .filter((params) => params.input.some((item) => item.text === prompt))
  strictEqual(matching.length, 1, 'Each UI send reaches the native provider exactly once')
  const actual = matching[0]
  ok(actual)
  deepStrictEqual(
    { model: actual.model, effort: actual.effort, serviceTier: actual.serviceTier },
    { model: expected.model, effort: expected.effort, serviceTier: expected.serviceTier },
  )
  strictEqual(actual.collaborationMode.settings.model, expected.model)
  strictEqual(actual.collaborationMode.settings.reasoning_effort, expected.effort)
  strictEqual(Object.hasOwn(actual, 'effort'), expected.effort !== undefined)
  strictEqual(Object.hasOwn(actual, 'serviceTier'), expected.serviceTier !== undefined)
  strictEqual(
    Object.hasOwn(actual.collaborationMode.settings, 'reasoning_effort'),
    expected.effort !== undefined,
  )
}

async function checkedOption(page: Page, group: string, choice: string) {
  strictEqual(
    await selectors.modelOptionChoice(page, group, choice).getAttribute('aria-checked'),
    'true',
  )
}

export const providerModelOptions = isolatedNativeScenario({
  name: 'provider-model-options',
  description:
    'Advertised model choices reach native turn/start exactly; untouched options are omitted and model changes reconcile unsupported choices.',
  fixture: new URL('../fixtures/native-model-options.mjs', import.meta.url),
  async drive(page, { step, root, orchestration, projectId, providerInstanceId }) {
    const before = (await readShell(page, orchestration)).projects.find(
      (project) => project.id === projectId,
    )
    ok(before, 'Fixture owner project exists')
    try {
      await selectors.modelOptions(page).click()
      await checkedOption(page, 'Reasoning', 'Medium')
      await checkedOption(page, 'Service tier', 'Standard')
      for (const choice of ['Standard', 'Priority', 'Flexible'])
        await selectors.modelOptionChoice(page, 'Service tier', choice).waitFor()
      await selectors.modelOptionChoice(page, 'Reasoning', 'future-effort-v3').waitFor()
      await settleAnimations(selectors.popupMenu(page))
      await step('advertised-effort-and-all-service-tiers')
      await page.keyboard.press('Escape')
      await sendWithOptions(page, root, 'OPTIONS_UNSELECTED', { model: 'gpt-5.5' })
      await step('unselected-options-are-omitted')

      await chooseOption(page, 'Reasoning', 'future-effort-v3')
      await chooseOption(page, 'Service tier', 'Standard')
      await sendWithOptions(page, root, 'OPTIONS_STANDARD', {
        model: 'gpt-5.5',
        effort: 'future-effort-v3',
        serviceTier: 'default',
      })
      await step('standard-and-future-effort-reach-native')
      await chooseOption(page, 'Service tier', 'Priority')
      await sendWithOptions(page, root, 'OPTIONS_PRIORITY', {
        model: 'gpt-5.5',
        effort: 'future-effort-v3',
        serviceTier: 'priority',
      })
      await step('priority-id-reaches-native')
      await chooseOption(page, 'Service tier', 'Flexible')
      await sendWithOptions(page, root, 'OPTIONS_FLEX', {
        model: 'gpt-5.5',
        effort: 'future-effort-v3',
        serviceTier: 'flex',
      })
      await step('flex-id-reaches-native')

      await selectors.modelPickerTrigger(page).click()
      await selectors.modelPickerOption(page, 'Options alternate').click()
      await selectors.modelPickerPanel(page).waitFor({ state: 'hidden' })
      await selectors.modelOptions(page).click()
      strictEqual(
        await selectors.modelOptionChoice(page, 'Reasoning', 'future-effort-v3').count(),
        0,
      )
      strictEqual(await selectors.modelOptionChoice(page, 'Service tier', 'Flexible').count(), 0)
      await checkedOption(page, 'Reasoning', 'Low')
      await checkedOption(page, 'Service tier', 'Economy v2')
      await settleAnimations(selectors.popupMenu(page))
      await step('model-switch-adopts-supported-defaults')
      await page.keyboard.press('Escape')
      await sendWithOptions(page, root, 'OPTIONS_ALTERNATE', {
        model: 'gpt-5.5-mini',
        effort: 'low',
        serviceTier: 'economy-v2',
      })
      await step('alternate-default-ids-reach-native')
    } finally {
      const current = (await readShell(page, orchestration)).projects.find(
        (project) => project.id === projectId,
      )
      if (current?.defaultModelSelection?.providerInstanceId === providerInstanceId)
        await dispatch(page, orchestration, {
          type: 'project.meta.update',
          projectId,
          defaultModelSelection: before.defaultModelSelection,
        })
      const restored = (await readShell(page, orchestration)).projects.find(
        (project) => project.id === projectId,
      )
      ok(restored, 'Fixture owner project remains after cleanup')
      if (current?.defaultModelSelection?.providerInstanceId === providerInstanceId)
        deepStrictEqual(restored.defaultModelSelection, before.defaultModelSelection)
      await appendFile(
        join(root, 'native.jsonl'),
        `${JSON.stringify({
          event: 'project-default-cleanup',
          projectId,
          before: before.defaultModelSelection,
          after: restored.defaultModelSelection,
        })}\n`,
      )
    }
  },
})
