import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { firstLoadFiles } from './first-load-files'
import { SHELL_ENTRIES, PHONE_BOOT_SCREENS } from './shell-chunks-plugin'

const fixtures: string[] = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true })
})

function buildFixture(shellLoader: string, screenImport: string) {
  const root = mkdtempSync(path.join(tmpdir(), 'first-load-files-'))
  fixtures.push(root)
  const dir = path.join(root, 'dist')
  mkdirSync(path.join(dir, 'assets'), { recursive: true })
  const files = {
    'initial.js': `import './common.js'; ${shellLoader}`,
    'common.js': 'export const common = 1',
    'shell.js': `export const screens = [() => import('./sessions.js'), () => import('./session.js')]`,
    'sessions.js': `import './${screenImport}'; export const list = 1`,
    'session.js': `import './${screenImport}'; export const chat = 1`,
    'workbench.js': 'export const desk = 1',
    'workbench.css': '.desk { display: grid }',
    'workbench-shared.js': 'export const bulky = 1',
    'phone-shared.js': 'export const small = 1',
  }
  for (const [name, source] of Object.entries(files))
    writeFileSync(path.join(dir, 'assets', name), source)
  writeFileSync(
    path.join(dir, 'index.html'),
    `<script src="/platform/assets/initial.js"></script>
    <link rel="modulepreload" href="/platform/assets/common.js">
    <script type="application/json" id="shell-chunks">{"phone":["/platform/assets/shell.js"]}</script>`,
  )
  writeFileSync(
    path.join(root, 'bundle-stats.json'),
    JSON.stringify({
      chunks: ['shell.js', 'sessions.js', 'session.js'].map((file, index) => ({
        fileName: `assets/${file}`,
        modules: [{ id: `/web/${[SHELL_ENTRIES.phone].concat(PHONE_BOOT_SCREENS)[index]}` }],
      })),
    }),
  )
  return dir
}

test('counts the selected first screen even when omitted from the boot manifest, and deduplicates files', () => {
  const dir = buildFixture(`const load = () => import('./shell.js')`, 'workbench-shared.js')
  expect(
    firstLoadFiles(dir, 'phone')
      .map((file) => file.fileName)
      .sort(),
  ).toEqual([
    'assets/common.js',
    'assets/initial.js',
    'assets/sessions.js',
    'assets/shell.js',
    'assets/workbench-shared.js',
  ])
})

test('counts desktop JS and CSS accidentally preloaded by the phone import', () => {
  const dir = buildFixture(
    `
    const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/workbench.js","assets/workbench.css"])))=>i.map(i=>d[i]);
    const load = kind => preload(kind === 'phone' ? () => import('./shell.js') : () => import('./workbench.js'), __vite__mapDeps([0,1]));
  `,
    'phone-shared.js',
  )
  const files = firstLoadFiles(dir, 'phone')
  expect(files.map((file) => file.fileName)).toContain('assets/workbench.js')
  expect(files.find((file) => file.fileName === 'assets/workbench.css')?.kind).toBe('stylesheet')
})

test('counts a direct conversation independently from the sessions list', () => {
  const dir = buildFixture(`const load = () => import('./shell.js')`, 'phone-shared.js')
  const files = firstLoadFiles(dir, 'phone', 'session').map((file) => file.fileName)
  expect(files).toContain('assets/session.js')
  expect(files).not.toContain('assets/sessions.js')
})
