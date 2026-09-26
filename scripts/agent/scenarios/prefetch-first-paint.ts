import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'

import { fixtureGit, openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { measurePress, pressStampScript, type PressTiming } from '../press-timing'
import {
  chords,
  diffPaneSelector,
  editorViewportSelector,
  markdownPreviewRowSelector,
  openGitPanel,
  selectors,
  sharedTokenHighlightPrefix,
} from '../selectors'
import type { Scenario } from './index'

const REPOSITORY = path.resolve(import.meta.dirname, '../../..')
// Real files, so parse cost matches the app's own sources; code.ts is the ~2,000-line diff.
const SOURCES: Readonly<Record<string, string>> = {
  'doc.md': 'AGENTS.md',
  'doc2.md': 'README.md',
  'doc3.md': 'AGENTS.md',
  'doc4.md': 'README.md',
  'notes.md': 'AGENTS.md',
  'code.ts': 'apps/web/src/lib/file-open-intent/state/service.ts',
  'code2.ts': 'apps/web/src/state/navigation.ts',
  'code3.ts': 'apps/web/src/features/editor/state/apply-actions.ts',
  'code4.ts': 'apps/web/src/features/editor/components/diff-pane.tsx',
}
const CHANGED = ['doc.md', 'code.ts', 'doc2.md', 'code2.ts']

const results = new WeakMap<Page, PressTiming[]>()

type Target = { readonly needle: string; readonly kind: 'file' | 'diff' }

// A view is the target's when it holds the marker line written into that file only.
function sampler({ needle, kind }: Target) {
  return `() => {
    const diff = ${JSON.stringify(kind === 'diff')}
    let view = null
    for (const element of document.querySelectorAll(diff ? ${JSON.stringify(diffPaneSelector)} : ${JSON.stringify(editorViewportSelector)})) {
      if (!element.checkVisibility()) continue
      if (!diff && element.closest(${JSON.stringify(diffPaneSelector)})) continue
      if ((element.textContent || '').includes(${JSON.stringify(needle)})) { view = element; break }
    }
    const frame = { t: performance.now(), text: view !== null, colour: false, preview: false }
    if (!view) return frame
    frame.preview = view.querySelector(${JSON.stringify(markdownPreviewRowSelector)}) !== null
    for (const [name, highlight] of CSS.highlights) {
      if (!name.startsWith(${JSON.stringify(sharedTokenHighlightPrefix)})) continue
      for (const range of highlight) {
        if (view.contains(range.startContainer)) { frame.colour = true; break }
      }
      if (frame.colour) break
    }
    return frame
  }`
}

async function measure(page: Page, name: string, target: Target, press: () => Promise<void>) {
  // Lets the previous open's background work settle, so each press starts from rest.
  await page.waitForTimeout(1200)
  const timing = await measurePress(page, name, sampler(target), press)
  results.get(page)?.push(timing)
  console.log(JSON.stringify(timing))
}

async function typeQuickOpen(page: Page, file: string) {
  await page.keyboard.press(chords.commandPalette)
  const input = selectors.paletteInput(page)
  await input.waitFor({ timeout: 5_000 })
  await input.fill(file)
  await page.waitForTimeout(600)
}

async function dwellOn(page: Page, name: string, dwellMs: number) {
  const box = await selectors.treeItem(page, name).boundingBox()
  if (!box) throw new Error(`Tree row ${name} is not laid out`)
  await page.mouse.move(box.x + 30, box.y + box.height / 2, { steps: 10 })
  await page.waitForTimeout(dwellMs)
}

async function nextTabName(page: Page) {
  const tabs = selectors.editorTabs(page)
  const paths = await tabs.evaluateAll((elements) =>
    elements.map((element) => ({
      path: element.getAttribute('data-editor-tab-path') ?? '',
      selected: element.getAttribute('aria-selected') === 'true',
    })),
  )
  const index = paths.findIndex((tab) => tab.selected)
  return path.basename(paths[(index + 1) % paths.length]?.path ?? '')
}

async function createFixture() {
  const fixture = await mkdtemp('/work/tmp/fregat-prefetch-first-paint-')
  try {
    await fixtureGit(fixture, ['init', '--quiet'])
    await fixtureGit(fixture, ['config', 'user.email', 'fregat@example.com'])
    await fixtureGit(fixture, ['config', 'user.name', 'Fregat'])
    for (const [name, source] of Object.entries(SOURCES)) {
      const lines = (await readFile(path.join(REPOSITORY, source), 'utf8')).split('\n')
      lines.splice(2, 0, name.endsWith('.md') ? `MARKFILE${name}` : `// MARKFILE${name}`)
      await writeFile(path.join(fixture, name), lines.join('\n'))
    }
    await fixtureGit(fixture, ['add', '.'])
    await fixtureGit(fixture, ['commit', '--quiet', '-m', 'initial'])
    for (const name of CHANGED) {
      const file = path.join(fixture, name)
      const lines = (await readFile(file, 'utf8')).split('\n')
      lines.splice(12, 1, `${lines[12]} MARKDIFF${name}`)
      lines.splice(40, 0, name.endsWith('.md') ? '- an added bullet' : '// an added comment')
      await writeFile(file, lines.join('\n'))
    }
    return fixture
  } catch (error) {
    await releaseFixture(fixture)
    throw error
  }
}

const file = (name: string): Target => ({ needle: `MARKFILE${name}`, kind: 'file' })
const diff = (name: string): Target => ({ needle: `MARKDIFF${name}`, kind: 'diff' })

export const prefetchFirstPaint: Scenario = {
  name: 'prefetch-first-paint',
  description:
    'Milliseconds from a press to the target’s first text, syntax colour and markdown preview, per open surface: quick open, keyboard tabs, tree rows with and without a hover, git diffs first and revisited.',
  inspect: async (page) => results.get(page) ?? null,
  async run(page, { step }) {
    results.set(page, [])
    const fixture = await createFixture()
    try {
      await page.addInitScript(pressStampScript)
      await openFixtureWorkspace(page, fixture)
      await selectors.treeItem(page, 'code.ts').waitFor({ timeout: 15_000 })
      await page.mouse.move(5, 5)
      await step('tree')

      const enter = () => page.keyboard.press('Enter')
      for (const [name, label] of [
        ['code3.ts', 'quick open ts, first of its language'],
        ['code4.ts', 'quick open ts, warm'],
        ['notes.md', 'quick open md, first of its language'],
        ['doc3.md', 'quick open md, warm'],
      ] as const) {
        await typeQuickOpen(page, name)
        await measure(page, label, file(name), enter)
      }
      await step('quick-open')

      await selectors.editorTabs(page).first().waitFor()
      for (const round of [1, 2, 3]) {
        const target = await nextTabName(page)
        await measure(page, `next tab, keyboard only, ${round}: ${target}`, file(target), () =>
          page.keyboard.press(chords.nextItem),
        )
      }
      await step('tabs')

      const click = () => page.mouse.down().then(() => page.mouse.up())
      await page.mouse.move(5, 5)
      await measure(page, 'tree md, no dwell', file('doc4.md'), () =>
        selectors.treeItem(page, 'doc4.md').click(),
      )
      for (const [name, dwellMs] of [
        ['doc.md', 1500],
        ['code.ts', 1500],
        ['doc2.md', 7000],
      ] as const) {
        await page.mouse.move(5, 5)
        await dwellOn(page, name, dwellMs)
        await measure(page, `tree ${name}, ${dwellMs / 1000} s hover`, file(name), click)
      }
      await page.mouse.move(5, 5)
      await step('tree-opens')

      await openGitPanel(page)
      await page.mouse.move(5, 5)
      const row = (name: string) => () => selectors.gitChangeRow(page, name).first().click()
      for (const [name, label] of [
        ['doc.md', 'git diff md, first'],
        ['code.ts', 'git diff ts, first'],
        ['doc.md', 'git diff md, revisit'],
        ['code.ts', 'git diff ts, revisit'],
        ['doc2.md', 'git diff md2, first'],
        ['code2.ts', 'git diff ts2, first'],
      ] as const) {
        await measure(page, label, diff(name), row(name))
      }
      await step('diffs')
    } finally {
      await releaseFixture(fixture)
    }
  },
}
