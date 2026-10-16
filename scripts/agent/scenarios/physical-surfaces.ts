import { ok, strictEqual } from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import { feedbackSoundCount, installFeedbackProbe } from '../feedback-probe'
import { committedFixture, openFixtureWorkspace } from '../fixture-workspace'
import { writeUserOperations } from '../preserve-settings'
import { chords, pressShortcut, selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'

export const physicalSurfaces: Scenario = {
  name: 'physical-surfaces',
  requiresIsolatedServer: true,
  description:
    'Count real pointer feedback on file rows, folder picker views, Settings choices and command palette; keep keyboard actions and native touch scrolling silent.',
  async run(page, { step, evidence }) {
    const { path: fixture, release } = await committedFixture('physical-surfaces')
    const mobile = (page.viewportSize()?.width ?? 1440) < 768
    try {
      await prepareFolders(fixture)
      await writeUserOperations(page, [
        { kind: 'set', key: 'workbench.sounds.controls', value: true },
        { kind: 'set', key: 'workbench.sounds.volume', value: 50 },
        { kind: 'set', key: 'workbench.feel', value: 'playful' },
        { kind: 'set', key: 'workbench.theme', value: null },
      ])
      await installFeedbackProbe(page)
      if (mobile) await openPhoneHome(page)
      else await openFixtureWorkspace(page, fixture)
      await page.waitForFunction(() => document.documentElement.dataset.feel === 'playful')
      if (!mobile) {
        await treeChoices(page, step)
        await step('tree-file-reselection-and-folder-toggle')
      }
      await openPicker(page, fixture, mobile)
      if (mobile) {
        await pointerSound(page, () => selectors.pickerRow(page, 'alpha').tap(), 'Touch folder')
        await selectors.physicalPickerLocation(page, path.join(fixture, 'alpha')).waitFor()
        await selectors.pickerUpOneFolder(page).click()
        await selectors.physicalPickerLocation(page, fixture).waitFor()
        await touchScroll(page)
        await step('touch-picker-navigation-and-silent-scroll')
      } else {
        await pickerViews(page)
        await step('picker-columns-list-icons')
      }
      await page.keyboard.press('Escape')
      await selectors.pickerDialog(page).waitFor({ state: 'hidden' })
      await settingsChoices(page, mobile)
      await step('settings-choice-lists-switch-label-select-and-disclosure')
      await paletteChoices(page, mobile, step)
      await step('command-palette-pointer-and-keyboard')
      await evidence.json('physical-surfaces-coverage.json', {
        mobile,
        tree: mobile
          ? 'covered by desktop run'
          : 'file, reselect, folder expand/collapse, keyboard',
        picker: mobile ? 'Touch navigation and Chromium native scroll' : 'Columns, List, Icons',
        settings:
          'palette, code theme, switch body and label, disabled switch, select, shortcuts disclosure',
        palette: 'real Settings command by pointer and keyboard',
        omitted: [
          'attachment file choices',
          'Places touch scrolling',
          'Settings category links',
          'Usage model toggles require real transcript seeding',
        ],
      })
    } catch (error) {
      await step('physical-surfaces-failed')
      throw error
    } finally {
      await release()
    }
  },
}

async function prepareFolders(root: string) {
  await mkdir(path.join(root, 'alpha', 'child'), { recursive: true })
  await mkdir(path.join(root, 'alpha', 'sibling'))
  await mkdir(path.join(root, 'beta'), { recursive: true })
  await writeFile(path.join(root, 'first.txt'), 'First\n')
  await writeFile(path.join(root, 'second.txt'), 'Second\n')
  for (let index = 0; index < 35; index += 1)
    await mkdir(path.join(root, `folder-${String(index).padStart(2, '0')}`))
}

async function pointerSound(page: Page, action: () => Promise<unknown>, label: string) {
  await page.waitForTimeout(80)
  const before = await feedbackSoundCount(page)
  await action()
  await page.waitForFunction(
    (expected) => Number(Reflect.get(window, 'physicalSoundCount') ?? 0) >= expected,
    before + 1,
    { timeout: 5000 },
  )
  await page.waitForTimeout(100)
  strictEqual(await feedbackSoundCount(page), before + 1, `${label}: exactly one sound`)
}

async function silentAction(page: Page, action: () => Promise<unknown>, label: string) {
  await page.waitForTimeout(80)
  const before = await feedbackSoundCount(page)
  await action()
  await page.waitForTimeout(150)
  strictEqual(await feedbackSoundCount(page), before, `${label}: silent`)
}

async function treeChoices(page: Page, step: (label: string) => Promise<void>) {
  const first = selectors.treeItem(page, 'first.txt')
  await pointerSound(page, () => first.click(), 'File selection')
  await selectors.editorInput(page).first().waitFor()
  const original = await first.boundingBox()
  ok(original, 'Selected file is visible')
  await first.hover()
  const beforePress = await feedbackSoundCount(page)
  await page.mouse.down()
  await page.waitForTimeout(180)
  strictEqual(await feedbackSoundCount(page), beforePress, 'Row pressure stays silent before click')
  const pressed = await first.boundingBox()
  ok(pressed, 'Pressed file is visible')
  for (const dimension of ['x', 'y', 'width', 'height'] as const)
    ok(Math.abs(pressed[dimension] - original[dimension]) < 1, `Row ${dimension} stays stationary`)
  ok(
    Number(await first.evaluate((element) => getComputedStyle(element).opacity)) < 1,
    'Selected file visibly dims while pressed',
  )
  await step('selected-file-pressed-with-stable-geometry')
  await pointerSound(page, () => page.mouse.up(), 'File reselection')
  const folder = selectors.treeItem(page, 'alpha')
  await pointerSound(page, () => folder.click(), 'Folder expansion')
  strictEqual(await folder.getAttribute('aria-expanded'), 'true')
  await pointerSound(page, () => folder.click(), 'Folder collapse')
  strictEqual(await folder.getAttribute('aria-expanded'), 'false')
  await folder.focus()
  await silentAction(page, () => page.keyboard.press('ArrowRight'), 'Keyboard folder expansion')
  strictEqual(await folder.getAttribute('aria-expanded'), 'true')
}

async function openPhoneHome(page: Page) {
  const home = new URL(page.url())
  home.pathname = home.pathname.startsWith('/platform/') ? '/platform/' : '/'
  home.search = ''
  home.hash = ''
  await page.goto(home.href)
  await selectors.phoneShell(page).waitFor()
}

async function openPicker(page: Page, fixture: string, mobile: boolean) {
  if (mobile) await selectors.physicalAddProject(page).click()
  else {
    await pointerSound(page, () => selectors.projectMenu(page).click(), 'Project menu trigger')
    await pointerSound(
      page,
      () => selectors.openFolderMenu(page).click(),
      'Open folder menu choice',
    )
  }
  await selectors.pickerDialog(page).waitFor()
  await selectors.physicalPickerGoToFolder(page).click()
  await selectors.pickerFolderPath(page).fill(fixture)
  await page.keyboard.press('Enter')
  await selectors.pickerRow(page, 'alpha').first().waitFor()
}

async function pickerViews(page: Page) {
  for (const view of ['Columns', 'List', 'Icons'] as const) {
    await selectors.pickerView(page, view).click()
    const alpha = selectors.pickerRow(page, 'alpha').first()
    await pointerSound(page, () => alpha.click(), `${view} selection`)
    await pointerSound(page, () => alpha.click(), `${view} reselection`)
    const list = view === 'Columns' ? selectors.pickerColumn(page, 0) : selectors.pickerList(page)
    await list.focus()
    await silentAction(page, () => page.keyboard.press('Home'), `${view} keyboard selection`)
  }
}

async function settingsChoices(page: Page, mobile: boolean) {
  await selectors.settingsOpen(page).click()
  const search = selectors.settingsSearch(page)
  await search.waitFor()
  await search.fill('workbench.palette')
  await chooseSettingsRow(page, 'workbench.palette')
  await search.fill('editor.codeTheme.light')
  await chooseSettingsRow(page, 'editor.codeTheme.light')
  await search.fill('semantic tokens')
  const parent = selectors.settingsSwitch(page, 'Semantic tokens enabled')
  const child = selectors.settingsSwitch(page, 'Semantic tokens delta')
  await parent.waitFor()
  const checked = await parent.getAttribute('aria-checked')
  await pointerSound(page, () => parent.click(), 'Settings switch body')
  strictEqual(await parent.getAttribute('aria-checked'), checked === 'true' ? 'false' : 'true')
  await pointerSound(
    page,
    () => selectors.physicalSettingLabel(page, 'lsp.semanticTokens.enabled').click(),
    'Settings switch label',
  )
  strictEqual(await parent.getAttribute('aria-checked'), checked)
  if ((await parent.getAttribute('aria-checked')) === 'true') await parent.click()
  ok(await child.isDisabled(), 'Dependent switch is disabled')
  await silentAction(page, () => child.click({ force: true }), 'Disabled switch')
  await parent.focus()
  await silentAction(page, () => page.keyboard.press('Space'), 'Keyboard switch')
  await search.fill('workbench.feel')
  await selectChoices(page, mobile)
  await search.fill('keyboard')
  const disclosure = selectors.shortcutEntries(page)
  await disclosure.waitFor()
  await pointerSound(page, () => disclosure.click(), 'Shortcuts disclosure open')
  strictEqual(await disclosure.getAttribute('aria-expanded'), 'true')
  await pointerSound(page, () => disclosure.click(), 'Shortcuts disclosure close')
  strictEqual(await disclosure.getAttribute('aria-expanded'), 'false')
  await disclosure.focus()
  await silentAction(page, () => page.keyboard.press('Enter'), 'Keyboard shortcuts disclosure')
  strictEqual(await disclosure.getAttribute('aria-expanded'), 'true')
}

async function selectChoices(page: Page, mobile: boolean) {
  if (mobile) {
    await pointerSound(page, () => selectors.settingsFeel(page).tap(), 'Phone select trigger')
    await pointerSound(page, () => selectors.feelOption(page, 'playful').tap(), 'Phone same choice')
    await pointerSound(page, () => selectors.settingsFeel(page).tap(), 'Phone select reopen')
    await pointerSound(
      page,
      () => selectors.feelOption(page, 'brisk').tap(),
      'Phone changed choice',
    )
    await page.waitForFunction(() => document.documentElement.dataset.feel === 'brisk')
    return
  }
  const trigger = selectors.settingsFeel(page)
  await trigger.hover()
  await page.waitForTimeout(80)
  const beforeOpen = await feedbackSoundCount(page)
  await page.mouse.down()
  strictEqual(await feedbackSoundCount(page), beforeOpen, 'Select pointer-down is silent')
  await pointerSound(page, () => page.mouse.up(), 'Settings default select trigger release')
  await pointerSound(
    page,
    () => selectors.feelOption(page, 'playful').click(),
    'Select same choice',
  )
  await trigger.hover()
  await page.mouse.down()
  const dragChoice = selectors.feelOption(page, 'brisk')
  await dragChoice.waitFor()
  const dragBounds = await dragChoice.boundingBox()
  ok(dragBounds, 'Press-drag choice is visible')
  await page.mouse.move(dragBounds.x + dragBounds.width / 2, dragBounds.y + dragBounds.height / 2, {
    steps: 8,
  })
  await pointerSound(page, () => page.mouse.up(), 'Select press-drag-release choice')
  await page.waitForFunction(() => document.documentElement.dataset.feel === 'brisk')
}

async function chooseSettingsRow(page: Page, id: string) {
  const list = selectors.physicalSettingChoices(page, id)
  await list.waitFor()
  const option = selectors.physicalUnselectedChoice(list).first()
  const name = await option.innerText()
  await pointerSound(page, () => option.click(), `${id} pointer choice`)
  const selected = selectors.physicalSelectedChoice(list)
  strictEqual(await selected.innerText(), name)
  await pointerSound(page, () => selected.click(), `${id} repeated choice`)
  await list.focus()
  await silentAction(page, () => page.keyboard.press('ArrowDown'), `${id} keyboard cursor`)
  await silentAction(page, () => page.keyboard.press('Enter'), `${id} keyboard choice`)
}

async function paletteChoices(page: Page, mobile: boolean, step: (label: string) => Promise<void>) {
  await pressShortcut(page, chords.commandPalette)
  await selectors.paletteInput(page).fill('>Settings')
  const command = selectors.commandOption(page, 'Settings').first()
  await command.waitFor()
  await silentAction(page, () => command.hover(), 'Command hover')
  await pointerSound(
    page,
    () => (mobile ? command.tap() : command.click()),
    'Real palette pointer command',
  )
  await selectors.paletteInput(page).waitFor({ state: 'hidden' })
  await step('palette-pointer-command-closed')
  await pressShortcut(page, chords.commandPalette)
  await selectors.paletteInput(page).fill('>Settings')
  await selectors.commandOption(page, 'Settings').first().waitFor()
  await silentAction(page, () => page.keyboard.press('Enter'), 'Real palette keyboard command')
  await selectors.paletteInput(page).waitFor({ state: 'hidden' })
  await waitForApp(page)
}

async function touchScroll(page: Page) {
  if (page.context().browser()?.browserType().name() !== 'chromium') return
  const list = selectors.pickerList(page)
  const box = await list.boundingBox()
  ok(box, 'Touch folder list is visible')
  const x = box.x + box.width / 2
  const y = box.y + box.height * 0.75
  const beforeScroll = await list.evaluate((element) => element.scrollTop)
  const cdp = await page.context().newCDPSession(page)
  try {
    await silentAction(
      page,
      async () => {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x, y }],
        })
        for (let index = 1; index <= 8; index += 1)
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x, y: y - index * 30 }],
          })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      },
      'Native touch scrolling',
    )
    ok((await list.evaluate((element) => element.scrollTop)) > beforeScroll, 'Touch scrolled rows')
  } finally {
    await cdp.detach()
  }
}
