import { strictEqual } from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import type { Page } from 'playwright'
import { countBlankFrames } from '../blank-frames'
import { createGitFixture, fixtureGit, releaseFixture } from '../fixture-workspace'
import { selectors, rootSwitchRows, folderTreeShadowHost } from '../selectors'
import { dispatch, openChat } from './chat-verification'
import { registerFixtureProject } from './native-provider-verification'
import type { Scenario } from './index'

export const rootSwitchNoFlicker: Scenario = {
  name: 'root-switch-no-flicker',
  description:
    'Switch idle sessions across cold roots with delayed Git and tree reads; both panels retain rows.',
  async run(page, { step }) {
    const base = await openChat(page)
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
          modelSelection: { providerInstanceId: 'codex', model: 'gpt-5.5' },
        })
      }
      await page.route(/\/(git\/status|fs\/tree)\?/, async (route) => {
        await page.waitForTimeout(700)
        await route.continue()
      })
      await selectors.sessionByTitle(page, titles[0]!).click()
      for (const tab of ['Git', 'Files'] as const) {
        counts.push(await measureRootSwitches(page, tab, titles, step))
      }
      strictEqual(counts[0], 0, 'Git root switches must keep rows on every frame')
      strictEqual(counts[1], 0, 'Tree root switches must keep rows on every frame')
      await verifyTreeState(page, titles)
      await step('tree-expansion-and-scroll-restored')
    } finally {
      // Obsolete reads can still be inside the injected delay when the run ends.
      await page.unrouteAll({ behavior: 'ignoreErrors' })
      await page.goto('about:blank')
      for (const root of roots) await releaseFixture(root)
    }
  },
}

async function waitForRoot(page: Page, tab: 'Git' | 'Files', index: number) {
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

async function verifyTreeState(page: Page, titles: readonly string[]) {
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
  await selectors.sessionByTitle(page, titles[1]!).click()
  await waitForRoot(page, 'Files', 1)
  await selectors.sessionByTitle(page, titles[0]!).click()
  await page.waitForFunction(`(() => {
    const scroll = document.querySelector(${JSON.stringify(folderTreeShadowHost)})?.shadowRoot?.querySelector('[data-file-tree-virtualized-scroll]')
    return scroll && Math.abs(scroll.scrollTop - ${top}) < 2
  })()`)
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
