import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fixtureGit, openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { strictEqual } from 'node:assert/strict'
import { openGitPanel, selectors } from '../selectors'
import type { Scenario } from './index'

const FILES = 3_000

// Page scripts are strings: the scripts project compiles without the DOM lib.
const startFrames = `(() => {
  const frames = { gaps: [], last: performance.now(), running: true }
  window.__agentScrollFrames = frames
  const sample = (now) => {
    if (!frames.running) return
    frames.gaps.push(now - frames.last)
    frames.last = now
    requestAnimationFrame(sample)
  }
  requestAnimationFrame(sample)
})()`

const stopFrames = `(() => {
  const frames = window.__agentScrollFrames
  frames.running = false
  const gaps = frames.gaps.slice(1).sort((a, b) => a - b)
  const at = (q) => Math.round(gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))] ?? 0)
  return {
    frames: gaps.length,
    over33ms: gaps.filter((gap) => gap > 33).length,
    p50: at(0.5),
    p95: at(0.95),
    max: Math.round(gaps.at(-1) ?? 0),
  }
})()`

// Tracked files with edits carry numstat counts, so every row draws its full `+/-` column.
async function buildRepository(fixture: string) {
  await fixtureGit(fixture, ['init', '-b', 'main'])
  for (let dir = 0; dir < FILES / 100; dir++)
    await mkdir(path.join(fixture, `module-${dir}`, 'src'), { recursive: true })
  const file = (index: number) =>
    path.join(fixture, `module-${Math.floor(index / 100)}`, 'src', `file-${index}.ts`)
  await Promise.all(
    Array.from({ length: FILES }, (_, index) => writeFile(file(index), 'a\nb\nc\n')),
  )
  await fixtureGit(fixture, ['add', '.'])
  await fixtureGit(fixture, ['-c', 'user.name=f', '-c', 'user.email=f@f', 'commit', '-qm', 'base'])
  await Promise.all(
    Array.from({ length: FILES }, (_, index) =>
      writeFile(file(index), `a\n${'x\n'.repeat(1 + (index % 40))}c\n`),
    ),
  )
}

export const gitChangesScroll: Scenario = {
  name: 'git-changes-scroll',
  description: `Wheel-scroll a Changes list of ${FILES.toLocaleString()} modified files in a fixture repo.`,
  async run(page, { step }) {
    const fixture = await mkdtemp('/work/tmp/fregat-git-scroll-')
    try {
      await buildRepository(fixture)
      await openFixtureWorkspace(page, fixture)
      await openGitPanel(page)
      const tree = selectors.gitChangeTree(page)
      await selectors.worktreeFiles(page).first().waitFor({ timeout: 20_000 })
      await page.waitForTimeout(2_000)
      await step('ready')
      const box = await tree.boundingBox()
      if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      // Control: the same sampler with nothing moving, so the scroll numbers have a floor.
      await page.evaluate(startFrames)
      await page.waitForTimeout(1_000)
      const idle = await page.evaluate(stopFrames)
      await page.evaluate(startFrames)
      for (let i = 0; i < 60; i++) {
        await page.mouse.wheel(0, 400)
        await page.waitForTimeout(16)
      }
      const wheel = await page.evaluate(stopFrames)
      await step('wheel-down')
      await page.evaluate(startFrames)
      for (let i = 0; i < 30; i++) {
        await page.mouse.wheel(0, i % 2 === 0 ? -3_000 : 2_000)
        await page.waitForTimeout(16)
      }
      const jumps = await page.evaluate(stopFrames)
      await step('wheel-jumps')
      const mounted = await selectors.worktreeFiles(page).count()
      console.log(JSON.stringify({ mountedRows: mounted, files: FILES, idle, wheel, jumps }))

      // Row buttons mount no Tooltip of their own; the shared layer must still name them.
      const row = selectors.worktreeFiles(page).nth(5)
      await row.hover()
      await row.getByRole('button', { name: 'Stage file' }).hover()
      const popup = selectors.tooltipPopup(page)
      await popup.waitFor({ timeout: 5_000 })
      strictEqual(await popup.count(), 1, 'Exactly one tooltip may be mounted')
      strictEqual((await popup.textContent())?.trim(), 'Stage file')
      await step('stage-tooltip')
    } finally {
      await releaseFixture(fixture)
    }
  },
}
