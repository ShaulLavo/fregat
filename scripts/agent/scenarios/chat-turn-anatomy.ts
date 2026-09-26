import { equal, ok } from 'node:assert/strict'
import type { Locator, Page } from 'playwright'

import type { Scenario } from './index'
import { selectors } from '../selectors'
import { dispatch, openChat, readSessionDetail, readShell } from './chat-verification'
import { sendPrompt, settingsSnapshot, writeSettings } from './native-provider-verification'

const STEP_DELAY_MS = 1_200
const FRAME = 'apps/web/src/features/chat/utils/work-log.ts:30'

type Evidence = {
  liveRowHeights: number[]
  maxBurst: { sweeps: number; rainbowOnTrigger: number } | null
  reducedMotionSweep: string | null
  caret: { label: string; painted: string | null; html: string }[]
  ultra: {
    levelBurst: boolean
    wordBurst: boolean
    burstMs: number
    triggerLabel: string | null
    word: string | null
    wordDrift: string
    driftAtRest: string
    driftOnHover: string
    rainbowRows: string[]
  } | null
}

const evidenceByPage = new WeakMap<Page, Evidence>()

/** Plan 160: one scripted mock turn shows every part of the turn anatomy. */
export const chatTurnAnatomy: Scenario = {
  name: 'chat-turn-anatomy',
  description:
    'A scripted mock turn: reasoning fold, fixed live tail, settled summary with failures, stack-frame links, dropped plan step, agent tree, max and ultra effort bursts, the ultra rainbow, the model marker and the reader-kept reasoning fold.',
  inspect: async (page) => evidenceByPage.get(page) ?? null,
  async run(page, { step }) {
    const evidence: Evidence = {
      liveRowHeights: [],
      maxBurst: null,
      reducedMotionSweep: null,
      caret: [],
      ultra: null,
    }
    evidenceByPage.set(page, evidence)
    const { base, cleanup, sessionId } = await createScriptedSession(page, await openChat(page))
    try {
      await firstTurn(page, step, evidence)
      await verifyTurnDuration(page, `${base}/orchestration`, sessionId)
      await maxBurst(page, step, evidence)
      await secondTurn(page, step)
      await thirdTurn(page, step)
      await ultrathinkWord(page, step, evidence)
      await stackFrame(page, step)
      await otherLooks(page, step, base)
    } catch (error) {
      await step('failed-before-cleanup')
      throw error
    } finally {
      await cleanup()
    }
  },
}

type Step = (label: string) => Promise<void>

async function firstTurn(page: Page, step: Step, evidence: Evidence) {
  await sendPrompt(page, 'Fix the failing stack-frame test.')
  const reasoning = selectors.reasoningRows(page).first()
  await reasoning.getByRole('button', { name: 'Thinking' }).waitFor()
  await expectExpanded(reasoning, 'true', 'Streaming reasoning opens while the timeline follows')
  await step('thinking-open')

  await selectors.activePlanTrigger(page).click()
  await selectors.liveTail(page).waitFor()
  await sampleLiveRow(page, evidence, () =>
    selectors
      .chatMessages(page)
      .getByRole('button', { name: /1 failed · / })
      .isVisible(),
  )
  await step('live-tail')
  const heights = new Set(evidence.liveRowHeights.map(Math.round))
  ok(heights.size === 1, `The live row kept one height while calls streamed: ${[...heights]}`)

  await reasoning.getByRole('button', { name: /^Thought for / }).waitFor()
  await expectExpanded(reasoning, 'false', 'Reasoning folds a second after its stream ends')
  await step('thought-folded')
  await step('summary-failed')

  const dropped = selectors
    .planSteps(page)
    .filter({ hasText: 'Write a migration' })
    .and(page.locator('[data-plan-step-status="dropped"]'))
  await dropped.waitFor({ timeout: 20_000 })
  ok(await dropped.locator('.line-through').count(), 'The dropped step is struck')
  await step('plan-dropped-step')

  await waitForTurnEnd(page)
  await selectors.agentsRow(page).click()
  await selectors.agentTreeChild(page, 'mock-checker').waitFor()
  // The side panel slides in; the screenshot waits for it to land.
  await page.waitForTimeout(500)
  await step('agent-tree')
  await page.keyboard.press('Escape')
}

async function verifyTurnDuration(page: Page, orchestration: string, sessionId: string) {
  const session = await readSessionDetail(page, orchestration, sessionId)
  const turn = session.latestTurn
  ok(turn?.startedAt && turn.completedAt, 'The settled turn has a start and end')
  const elapsed = Date.parse(turn.completedAt) - Date.parse(turn.startedAt)
  ok(elapsed >= STEP_DELAY_MS * 3, `The duration includes the scripted work: ${elapsed}ms`)
  const fold = selectors.completedWorkGroup(page).first()
  await fold.waitFor()
  ok(!/Worked for \d+ms/.test(await fold.innerText()), 'The fold reports seconds of work')
}

async function maxBurst(page: Page, step: Step, evidence: Evidence) {
  await selectors.modelOptions(page).click()
  await page.getByRole('menuitemradio', { name: 'Max', exact: true }).click()
  const burst = selectors.effortBurst(page, 'max')
  await burst.waitFor({ state: 'attached' })
  // Mid-sweep, so the screenshot shows the band crossing.
  await page.waitForTimeout(300)
  await step('burst-max')
  evidence.maxBurst = {
    sweeps: await burst.locator('.effort-sweep').count(),
    rainbowOnTrigger: await selectors.effortRainbow(selectors.modelOptions(page)).count(),
  }
  await burst.waitFor({ state: 'detached' })
  equal(evidence.maxBurst.sweeps, 1, 'Max plays the smaller, single-band burst')
  equal(evidence.maxBurst.rainbowOnTrigger, 0, 'Max leaves the trigger plain')

  // Leaving and re-entering max replays it; reduced motion keeps only the wash.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await selectors.modelOptions(page).click()
  await page.getByRole('menuitemradio', { name: 'High', exact: true }).click()
  await selectors.modelOptions(page).click()
  await page.getByRole('menuitemradio', { name: 'Max', exact: true }).click()
  evidence.reducedMotionSweep = await burst
    .locator('.effort-sweep')
    .evaluate((sweep) => getComputedStyle(sweep).display)
  await burst.waitFor({ state: 'detached' })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  equal(evidence.reducedMotionSweep, 'none', 'Reduced motion drops the moving band')
}

async function secondTurn(page: Page, step: Step) {
  await sendPrompt(page, 'Now run it at max effort.')
  const marker = selectors.modelSwitch(page)
  await marker.waitFor()
  ok((await marker.textContent())?.includes('Switched to GPT-5.5 · Max'), 'The marker names it')
  await step('model-switch-marker')

  const reasoning = await streamingReasoning(page)
  await expectExpanded(reasoning, 'true', 'The second turn opens its reasoning too')
  const toggle = reasoning.getByRole('button')
  const top = (await reasoning.boundingBox())?.y
  await toggle.click()
  await toggle.click()
  const after = (await reasoning.boundingBox())?.y
  ok(
    top !== undefined && after !== undefined && Math.abs(after - top) <= 1,
    'A reader toggle keeps the row in place',
  )
  await reasoning.getByRole('button', { name: /^Thought for / }).waitFor()
  await page.waitForTimeout(2_000)
  await expectExpanded(reasoning, 'true', 'A reader-opened fold stays open after the stream')
  await step('reader-kept-open')
  await waitForTurnEnd(page)
}

async function thirdTurn(page: Page, step: Step) {
  await selectors
    .timelineJumpToLatest(page)
    .click({ timeout: 2_000 })
    .catch(() => undefined)
  await sendPrompt(page, 'Once more, while I read back.')
  const reasoning = await streamingReasoning(page)
  await expectExpanded(reasoning, 'true', 'The third turn opens its reasoning')
  await selectors.chatMessages(page).hover()
  await page.mouse.wheel(0, -300)
  await reasoning.getByRole('button', { name: /^Thought for / }).waitFor()
  await page.waitForTimeout(2_000)
  await expectExpanded(reasoning, 'true', 'Nothing folds while the reader has scrolled away')
  await step('scrolled-away-kept-open')

  await selectors.timelineJumpToLatest(page).click()
  await expectExpanded(reasoning, 'false', 'Back at the tail, the fold settles')
  await step('back-at-tail-folded')
  await waitForTurnEnd(page)
}

async function ultrathinkWord(page: Page, step: Step, evidence: Evidence) {
  const trigger = selectors.modelOptions(page)
  const burst = selectors.effortBurst(page, 'ultra')
  const burstPlays = () =>
    burst
      .waitFor({ state: 'attached', timeout: 2_000 })
      .then(() => true)
      .catch(() => false)

  // An `ultra` level id, the one Codex uses.
  await trigger.click()
  await page.getByRole('menuitemradio', { name: 'Ultra', exact: true }).click()
  const levelBurst = await burstPlays()
  await page.waitForTimeout(350)
  await step('burst-ultra')
  await burst.waitFor({ state: 'detached', timeout: 5_000 })

  // Ultrathink from the menu is a stored level: the prompt stays empty.
  await trigger.click()
  await page.getByRole('menuitemradio', { name: 'Ultrathink', exact: true }).click()
  const storedBurst = await burstPlays()
  await step('menu-ultrathink-stored')
  const storedPrompt = await selectors.chatMessage(page).innerText()
  const storedLabel = await selectors.effortRainbow(trigger).textContent()
  await burst.waitFor({ state: 'detached', timeout: 5_000 })
  await trigger.click()
  await page.getByRole('menuitemradio', { name: 'Ultra', exact: true }).click()
  await burst.waitFor({ state: 'detached', timeout: 5_000 })

  // Ultra to a typed Ultrathink is a new level, so it plays again.
  await selectors.fillChatMessage(page, 'Please ultrathink about the parser.')
  const wordBurst = await burstPlays()
  const burstStart = Date.now()
  const word = selectors.effortRainbow(selectors.chatMessage(page))
  await word.waitFor()
  await step('composer-ultrathink')
  await burst.waitFor({ state: 'detached', timeout: 5_000 })
  const burstMs = Date.now() - burstStart

  const label = selectors.effortRainbow(trigger)
  const playState = (locator: Locator) =>
    locator.evaluate((node) => getComputedStyle(node).animationPlayState)
  const driftAtRest = await playState(label)
  await trigger.hover()
  const driftOnHover = await playState(label)
  await step('trigger-ultra-hover')
  await trigger.click()
  await page.getByRole('menuitemradio', { name: 'Ultrathink', exact: true }).waitFor()
  const rainbowRows = await page
    .getByRole('menuitemradio')
    .filter({ has: page.locator('.rainbow-text') })
    .allInnerTexts()
  // The word in the body locks the menu, so its rows are read, not hovered.
  await step('menu-ultra-rows')
  await page.keyboard.press('Escape')
  const replayed = await burst.count()
  const caret = await caretKeepsRainbow(page, word, step)

  evidence.ultra = {
    levelBurst,
    wordBurst,
    burstMs,
    triggerLabel: await label.textContent(),
    word: await word.textContent(),
    wordDrift: await playState(word),
    driftAtRest,
    driftOnHover,
    rainbowRows,
  }
  evidence.caret = caret
  ok(levelBurst, 'Picking Ultra plays the ultra burst')
  ok(wordBurst, 'Ultra to Ultrathink plays it again')
  ok(burstMs < 2_500, `The ultra burst ends on its own: ${burstMs}ms`)
  equal(replayed, 0, 'Hovering and opening the menu do not replay it')
  ok(storedBurst, 'Ultrathink from the menu plays the burst')
  equal(storedPrompt.trim(), '', 'Ultrathink from the menu leaves the prompt alone')
  equal(storedLabel, 'Ultrathink', 'The trigger paints the stored Ultrathink')
  equal(evidence.ultra.word, 'ultrathink', 'The composer word is one rainbow span')
  equal(evidence.ultra.wordDrift, 'running', 'The composer word drifts')
  equal(evidence.ultra.triggerLabel, 'Ultrathink', 'The trigger paints the ultra effort')
  equal(driftAtRest, 'paused', 'The trigger rainbow rests until hovered')
  equal(driftOnHover, 'running', 'Hover sets the trigger rainbow drifting')
  equal(rainbowRows.join(), 'Ultra,Ultrathink', 'Only the ultra rows wear the rainbow')
  for (const probe of caret)
    equal(probe.painted, 'ultrathink', `The word keeps its rainbow: ${probe.label} ${probe.html}`)
  await selectors.fillChatMessage(page, '')
}

/** A caret next to, inside, or typing beside the word must leave it painted. */
async function caretKeepsRainbow(page: Page, word: Locator, step: Step) {
  const composer = selectors.chatMessage(page)
  const probes: { label: string; painted: string | null; html: string }[] = []
  const probe = async (label: string) => {
    await page.waitForTimeout(200)
    await step(`caret-${label.replaceAll(' ', '-')}`)
    probes.push({
      label,
      painted: await selectors
        .effortRainbow(composer)
        .first()
        .textContent({ timeout: 500 })
        .catch(() => null),
      html: await composer.innerHTML(),
    })
  }
  const box = await word.boundingBox()
  if (!box) throw new Error('the painted word has no box')
  await page.mouse.click(box.x + box.width - 1, box.y + box.height / 2)
  await probe('caret after the word')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await probe('caret inside the word')
  await page.keyboard.press('End')
  await page.keyboard.type(' now', { delay: 40 })
  await probe('typing at the end')
  await page.mouse.click(box.x + 1, box.y + box.height / 2)
  await probe('caret before the word')
  await selectors.fillChatMessage(page, '')
  await composer.click()
  await page.keyboard.type('Please ultrathink', { delay: 40 })
  await probe('typed the word')
  await page.keyboard.type(' about it', { delay: 40 })
  await probe('typing after the word')
  await selectors.fillChatMessage(page, 'Please ultrathink about the parser.')
  return probes
}

async function stackFrame(page: Page, step: Step) {
  const failed = selectors.chatMessages(page).getByRole('button', { name: /tool call failed/ })
  await failed.first().scrollIntoViewIfNeeded()
  await failed.first().click()
  const frame = selectors.stackFrame(page, FRAME)
  await frame.scrollIntoViewIfNeeded()
  await step('stack-frames')
  await frame.click()
  await page.locator('[data-editor-tab-path$="/work-log.ts"]').first().waitFor()
  await step('stack-frame-opened')
}

/** The row of the reasoning streaming now, pinned by id so a later row cannot stand in. */
async function streamingReasoning(page: Page) {
  const thinking = selectors.reasoningRows(page).filter({
    has: page.getByRole('button', { name: 'Thinking' }),
  })
  await thinking.waitFor()
  const id = await thinking.getAttribute('data-work-log-entry-id')
  ok(id, 'A reasoning row carries its entry id')
  return selectors.reasoningRow(page, id)
}

/** The same transcript in dark mode and at cozy density. */
async function otherLooks(page: Page, step: Step, base: string) {
  await writeSettings(page, base, [{ kind: 'set', key: 'workbench.colorTheme', value: 'dark' }])
  await selectors.fillChatMessage(page, 'Please ultrathink about the parser.')
  // Past the ultra burst, so the shot shows the resting rainbow.
  await page.waitForTimeout(1_600)
  await step('dark-mode')
  await selectors.fillChatMessage(page, '')
  await writeSettings(page, base, [
    { kind: 'reset', keys: ['workbench.colorTheme'] },
    { kind: 'set', key: 'workbench.density', value: 'cozy' },
  ])
  await page.waitForTimeout(500)
  await step('cozy-density')
  await writeSettings(page, base, [{ kind: 'reset', keys: ['workbench.density'] }])
}

async function sampleLiveRow(page: Page, evidence: Evidence, until: () => Promise<boolean>) {
  const row = selectors.liveActivityRow(page)
  const deadline = Date.now() + 40_000
  while (Date.now() < deadline) {
    if (await until()) return
    const box = await row.boundingBox().catch(() => null)
    if (box && (await selectors.liveTail(page).isVisible()))
      evidence.liveRowHeights.push(box.height)
    await page.waitForTimeout(150)
  }
  ok(false, 'The settled summary with a failure never appeared')
}

async function expectExpanded(row: Locator, expanded: 'false' | 'true', message: string) {
  const toggle = row.getByRole('button').first()
  const deadline = Date.now() + 4_000
  while (Date.now() < deadline) {
    if ((await toggle.getAttribute('aria-expanded')) === expanded) return
    await row.page().waitForTimeout(100)
  }
  ok(false, message)
}

async function waitForTurnEnd(page: Page) {
  await selectors.liveActivityRow(page).waitFor({ state: 'detached', timeout: 60_000 })
}

/** A mock provider instance running the scripted turn, and a session on it. */
async function createScriptedSession(page: Page, orchestration: string) {
  const base = orchestration.replace(/\/orchestration$/, '')
  const before = await settingsSnapshot(page, base)
  const originallySet =
    before.layers.find((layer) => layer.id === 'user')?.raw['providers.instances'] !== undefined
  const originalInstances = before.values['providers.instances']
  const providerInstanceId = `anatomy-${crypto.randomUUID()}`
  const sessionId = crypto.randomUUID()
  const title = `chat-turn-anatomy ${sessionId.slice(0, 8)}`
  await writeSettings(page, base, [
    {
      kind: 'provider.setEnabled',
      providerInstanceId,
      enabled: true,
      createIfMissing: {
        driverKind: 'mock',
        displayLabel: 'Scripted mock',
        config: { script: 'turn-anatomy', stepDelayMs: STEP_DELAY_MS },
      },
    },
  ])
  const worktree = await firstWorktree(page, orchestration)
  await dispatch(page, orchestration, {
    type: 'session.create',
    sessionId,
    title,
    worktreeTarget: { kind: 'current', worktreeId: worktree.id },
    modelSelection: { providerInstanceId, model: 'gpt-5.5' },
  })
  await selectors.sessionSearch(page).fill(title)
  await selectors.sessionByTitle(page, title).click()
  await page.waitForURL((url) => url.href.includes(sessionId))
  await page.reload()
  await selectors.chatMessage(page).waitFor()

  const cleanup = async () => {
    await dispatch(page, orchestration, { type: 'session.runtime.stop', sessionId })
    await dispatch(page, orchestration, { type: 'session.delete', sessionId })
    const current = await settingsSnapshot(page, base)
    const remaining = current.values['providers.instances'].filter(
      (item) => item.providerInstanceId !== providerInstanceId,
    )
    const unchanged = JSON.stringify(remaining) === JSON.stringify(originalInstances)
    await writeSettings(page, base, [
      !originallySet && unchanged
        ? { kind: 'reset', keys: ['providers.instances'] }
        : { kind: 'set', key: 'providers.instances', value: remaining },
    ])
  }
  return { base, cleanup, sessionId }
}

async function firstWorktree(page: Page, base: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const worktree = (await readShell(page, base)).worktrees[0]
    if (worktree) return worktree
    await page.waitForTimeout(100)
  }
  ok(false, 'A worktree exists')
}
