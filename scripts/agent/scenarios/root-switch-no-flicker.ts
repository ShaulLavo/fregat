import { strictEqual } from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import type { Page } from 'playwright'
import { countBlankFrames } from '../blank-frames'
import { createGitFixture, fixtureGit, releaseFixture } from '../fixture-workspace'
import { selectors, rootSwitchRows, folderTreeShadowHost, openFileByName } from '../selectors'
import { dispatch, openChat } from './chat-verification'
import { registerFixtureProject, writeSettings } from './native-provider-verification'
import type { Scenario } from './index'

export const rootSwitchNoFlicker: Scenario = {
  name: 'root-switch-no-flicker',
  description:
    'Switch idle sessions across cold roots with delayed Git and tree reads; both panels retain rows.',
  async run(page, { step }) {
    const base = await openChat(page)
    const providerInstanceId = `root-switch-${crypto.randomUUID()}`
    await writeSettings(page, base.replace(/\/orchestration$/, ''), [
      {
        kind: 'provider.setEnabled',
        providerInstanceId,
        enabled: true,
        createIfMissing: { driverKind: 'mock', displayLabel: 'Root switch fixture', config: {} },
      },
    ])
    const roots: string[] = []
    const counts: number[] = []
    try {
      const titles: string[] = []
      for (let index = 0; index < 3; index += 1) {
        const root = await createGitFixture(`root-switch-${index}`)
        roots.push(root)
        if (index === 0) await addExpandedFolder(root)
        await fixtureGit(root, ['add', '.'])
        await fixtureGit(root, ['commit', '--quiet', '-m', 'fixture'])
        await writeFile(`${root}/root-${index}.txt`, 'untracked\n')
        const worktree = await registerFixtureProject(page, base, root)
        const title = `Root switch ${index}`
        titles.push(title)
        await dispatch(page, base, {
          type: 'session.create',
          sessionId: crypto.randomUUID(),
          title,
          worktreeTarget: { kind: 'current', worktreeId: worktree.id },
          modelSelection: { providerInstanceId, model: 'gpt-5.5' },
        })
      }
      await page.route(/\/(git\/status|fs\/tree)\?/, async (route) => {
        await page.waitForTimeout(700)
        await route.continue()
      })
      await selectors.sessionByTitle(page, titles[0]!).click()
      counts.push(await measureRootSwitches(page, 'Git', titles, step))
      await selectors.sessionByTitle(page, titles[1]!).click()
      await openFileByName(page, 'root-1.txt')
      await selectors.sessionByTitle(page, titles[0]!).click()
      await openFileByName(page, 'root-0.txt')
      await waitForRoot(page, 'Files', 0)
      await verifyTreeState(page, titles, step)
      await step('tree-expansion-and-scroll-restored')
      await selectors.folderTree(page).hover()
      await page.mouse.wheel(0, -10000)
      await selectors.treeItem(page, 'expanded').focus()
      await page.keyboard.press('ArrowLeft')
      counts.push(await measureRootSwitches(page, 'Files', titles, step))
      strictEqual(counts[0], 0, 'Git root switches must keep rows on every frame')
      strictEqual(counts[1], 0, 'Tree root switches must keep rows on every frame')
      await verifyMissingRoot(page, titles, roots[0]!, step)
    } finally {
      // Obsolete reads can still be inside the injected delay when the run ends.
      await page.unrouteAll({ behavior: 'ignoreErrors' })
      await page.goto('about:blank')
      for (const root of roots) await releaseFixture(root)
    }
  },
}

async function waitForRoot(page: Page, tab: 'Git' | 'Files', index: number) {
  const trigger = selectors.chatToolTab(page, tab)
  if ((await trigger.getAttribute('aria-pressed')) !== 'true') await trigger.click()
  const row =
    tab === 'Git'
      ? selectors.gitChangeTree(page).getByText(`root-${index}.txt`, { exact: true })
      : selectors.treeItem(page, `root-${index}.txt`)
  await row.waitFor({ timeout: 20_000 })
}

async function addExpandedFolder(root: string) {
  await mkdir(`${root}/expanded`)
  await Promise.all(
    Array.from({ length: 100 }, (_, index) =>
      writeFile(`${root}/expanded/child-${String(index).padStart(3, '0')}.txt`, 'child\n'),
    ),
  )
}

async function verifyTreeState(
  page: Page,
  titles: readonly string[],
  step: Parameters<Scenario['run']>[1]['step'],
) {
  await selectors.treeItem(page, 'expanded').focus()
  await page.keyboard.press('ArrowRight')
  await selectors.treeItem(page, 'child-000.txt').waitFor()
  await selectors.folderTree(page).hover()
  await page.mouse.wheel(0, 500)
  const scroll = selectors.folderTreeScroll(page)
  await page.waitForFunction(
    (element) => element !== null && element.scrollTop > 100,
    await scroll.elementHandle(),
  )
  const top = await scroll.evaluate((element) => element.scrollTop)
  await step('selected-first-root-expanded-and-scrolled')
  await selectors.sessionByTitle(page, titles[1]!).click()
  await selectors.filesPaneLoading(page).waitFor()
  strictEqual(
    await scroll.evaluate((element) => Math.round(element.scrollTop)),
    Math.round(top),
    'The held first root keeps its scroll while the second root loads',
  )
  await step('selected-first-root-held')
  await waitForRoot(page, 'Files', 1)
  await selectors.sessionByTitle(page, titles[0]!).click()
  await step('selected-first-root-returned')
  await page.waitForFunction(`(() => {
    const scroll = document.querySelector(${JSON.stringify(folderTreeShadowHost)})?.shadowRoot?.querySelector('[data-file-tree-virtualized-scroll]')
    return scroll && Math.abs(scroll.scrollTop - ${top}) < 2
  })()`)
}

async function verifyMissingRoot(
  page: Page,
  titles: readonly string[],
  root: string,
  step: Parameters<Scenario['run']>[1]['step'],
) {
  await selectors.sessionByTitle(page, titles[1]!).click()
  await waitForRoot(page, 'Files', 1)
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  await page.route(/\/fs\/tree\?/, async (route) => {
    if (new URL(route.request().url()).searchParams.get('path') !== root.replace(/^\//, '')) {
      await route.fallback()
      return
    }
    started.resolve()
    await release.promise
    await route.continue()
  })
  try {
    await selectors.sessionByTitle(page, titles[0]!).click()
    await started.promise
    await selectors.treeItem(page, 'root-0.txt').waitFor()
    await step('saved-first-root-awaiting-confirmation')
    await rm(root, { recursive: true })
    release.resolve()
    await selectors.filesPaneError(page).waitFor()
    strictEqual(
      await selectors.folderTree(page).count(),
      0,
      'A missing root must discard its saved rows',
    )
    await step('deleted-root-error-without-saved-rows')
  } finally {
    release.resolve()
  }
}

async function measureRootSwitches(
  page: Page,
  tab: 'Git' | 'Files',
  titles: readonly string[],
  step: Parameters<Scenario['run']>[1]['step'],
) {
  const trigger = selectors.chatToolTab(page, tab)
  if ((await trigger.getAttribute('aria-pressed')) !== 'true') await trigger.click()
  await waitForRoot(page, tab, 0)
  await step(`${tab}-first-root`)
  const shadowHost = tab === 'Files' ? folderTreeShadowHost : undefined
  strictEqual(
    await countBlankFrames(page, rootSwitchRows[tab], () => page.waitForTimeout(100), shadowHost),
    0,
    'The loaded rows must be observable before sampling switches',
  )
  const blank = await countBlankFrames(
    page,
    rootSwitchRows[tab],
    async () => {
      for (const index of [1, 2, 0]) {
        await selectors.sessionByTitle(page, titles[index]!).click()
        await waitForRoot(page, tab, index)
      }
    },
    shadowHost,
  )
  await step(`${tab}-blank-frames-${blank}`)
  return blank
}
