import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import { fixtureGit, openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { writeUserOperations } from '../preserve-settings'
import { chords, openFileByName, openGitPanel, selectors } from '../selectors'
import type { Scenario } from './index'

/** One file per hue and per two-hue icon, plus the aliases and pack maps the rules added. */
const FILES = [
  'app.ts',
  'view.tsx',
  'main.js',
  'main.c',
  'main.cpp',
  'Program.cs',
  'script.py',
  'notebook.ipynb',
  'page.astro',
  'webpack.config.js',
  'bun.lock',
  'style.css',
  'theme.less',
  'data.csv',
  'index.html',
  'schema.sql',
  'Cargo.toml',
  'pom.xml',
  'run.ps1',
  'fix.patch',
  'LICENSE',
  'server.ts',
  'events.jsonl',
  'Dockerfile',
  'README.md',
  'go.mod',
  'lib.rs',
  'build.zig',
] as const

/**
 * File icons across the app in light and dark: the editor tab strip, quick open, git changes and
 * the /dev icon sheet. Every file is uncommitted, so git lists them all.
 */
export const fileIconHues: Scenario = {
  name: 'file-icon-hues',
  description:
    'Show file icon hues in tabs, quick open, git changes and the /dev icon sheet in light and dark.',
  capture: { scale: 2, width: 1440, height: 900 },
  async run(page, { step }) {
    const fixture = await mkdtemp('/work/tmp/fregat-icon-hues-')
    try {
      await fixtureGit(fixture, ['init', '--quiet'])
      await writeFile(path.join(fixture, '.gitignore'), 'nothing\n')
      for (const name of FILES) {
        await mkdir(path.dirname(path.join(fixture, name)), { recursive: true })
        await writeFile(path.join(fixture, name), `${name}\n`)
      }
      await openFixtureWorkspace(page, fixture)
      for (const name of [
        'app.ts',
        'script.py',
        'page.astro',
        'webpack.config.js',
        'main.c',
        '.gitignore',
        'bun.lock',
        'schema.sql',
      ]) {
        await openFileByName(page, name)
      }
      for (const mode of ['light', 'dark'] as const) {
        await setMode(page, mode)
        await step(`${mode}-tabs`)
        await page.keyboard.press(chords.commandPalette)
        await selectors.paletteInput(page).fill('.')
        await page.waitForTimeout(600)
        await step(`${mode}-quick-open`)
        await page.keyboard.press('Escape')
      }
      await openGitPanel(page)
      await selectors.worktreeFiles(page).first().waitFor({ timeout: 15_000 })
      for (const mode of ['light', 'dark'] as const) {
        await setMode(page, mode)
        await step(`${mode}-git-changes`)
      }
      await page.goto(new URL('/dev/icons', page.url()).href)
      await page.getByText('File icons', { exact: true }).waitFor({ timeout: 15_000 })
      for (const mode of ['light', 'dark'] as const) {
        // The gallery page keeps the boot mode; set the class the app would.
        await page.evaluate((next) => {
          document.documentElement.classList.remove('light', 'dark')
          document.documentElement.classList.add(next)
        }, mode)
        await step(`${mode}-sheet`)
      }
    } finally {
      await releaseFixture(fixture)
    }
  },
}

async function setMode(page: Page, mode: 'light' | 'dark') {
  await writeUserOperations(page, [{ kind: 'set', key: 'workbench.colorTheme', value: mode }])
  await page.waitForFunction((next) => document.documentElement.classList.contains(next), mode)
  await page.waitForTimeout(300)
}
