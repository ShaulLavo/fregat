import { fileIconRule, fileTreeIconsForPaths, iconForEntry } from '@/lib/file-icons'
import { expect, test } from '../../../test/fixtures'

function iconFor(name: string) {
  const rule = fileIconRule(iconForEntry({ name, type: 'file' }))
  return `${rule.glyph} ${rule.hue}`
}

test.each([
  // A stem no longer beats the extension: these are TypeScript files.
  ['server.ts', 'typescript blue'],
  ['config.ts', 'typescript blue'],
  ['vscode.d.ts', 'lang-typescript blue'],
  // Exact names still win.
  ['package.json', 'npm red'],
  ['CLAUDE.md', 'claude orange'],
  ['vite.config.ts', 'vite purple'],
])('%s draws %s', (name, expected) => {
  expect(iconFor(name)).toBe(expected)
})

test.each([
  ['Cargo.toml', 'gear gray'],
  ['flake.nix', 'gear gray'],
  ['build.gradle', 'gear gray'],
  ['app.service', 'gear gray'],
  ['pom.xml', 'code gray'],
  ['Info.plist', 'code gray'],
  ['run.ps1', 'bash green'],
  ['build.bat', 'bash green'],
  ['fix.patch', 'file-text-duo gray'],
  ['changes.diff', 'file-text-duo gray'],
  ['yarn.lock', 'file-text-duo gray'],
  ['LICENSE', 'file-text-duo gray'],
  ['NOTICE', 'file-text-duo gray'],
  ['CODEOWNERS', 'file-text-duo gray'],
  ['notebook.ipynb', 'lang-python blue'],
  ['site.webmanifest', 'braces orange'],
  ['bundle.js.map', 'braces orange'],
])('the alias %s draws %s', (name, expected) => {
  expect(iconFor(name)).toBe(expected)
})

test.each([
  ['schema.sql', 'server-duo purple'],
  ['cache.sqlite', 'server-duo purple'],
  ['module.mts', 'typescript blue'],
  ['legacy.cts', 'typescript blue'],
  ['Program.cs', 'lang-c purple'],
  ['events.jsonl', 'braces orange'],
  ['theme.less', 'css indigo'],
  ['.prettierignore', 'prettier teal'],
  ['.npmignore', 'npm red'],
  ['setup.ini', 'file-text-duo gray'],
  ['README.rst', 'file-text-duo gray'],
  ['app.code-workspace', 'vscode blue'],
  ['Gemfile', 'lang-ruby red'],
])('the pack map sends %s to %s', (name, expected) => {
  expect(iconFor(name)).toBe(expected)
})

test('C and C++ are blue, git is vermilion, bun is mauve', () => {
  expect(iconFor('main.c')).toBe('lang-c blue')
  expect(iconFor('main.cpp')).toBe('lang-c blue')
  expect(iconFor('.gitignore')).toBe('git vermilion')
  expect(iconFor('bun.lock')).toBe('bun-duo mauve')
})

test('Python, Astro and webpack paint their back layer in a second hue', () => {
  expect(fileIconRule(iconForEntry({ name: 'app.py', type: 'file' })).className).toContain(
    '[--file-icon-back:var(--color-file-icon-yellow)]',
  )
  expect(fileIconRule(iconForEntry({ name: 'page.astro', type: 'file' })).className).toContain(
    '[--file-icon-back:var(--color-file-icon-pink)]',
  )
  expect(
    fileIconRule(iconForEntry({ name: 'webpack.config.js', type: 'file' })).className,
  ).toContain('[--file-icon-back:var(--color-file-icon-cyan)]')
  expect(fileIconRule(iconForEntry({ name: 'app.ts', type: 'file' })).className).not.toContain(
    '--file-icon-back',
  )
})

test.each(['constructor', '__proto__', 'toString'])(
  '%s resolves to the default file icon',
  (name) => {
    expect(iconFor(name)).toBe('file-duo gray')
  },
)

test.each(['constructor', '__proto__', 'toString'])(
  '%s gets its own default tree icon override',
  (name) => {
    const icons = fileTreeIconsForPaths([`src/${name}`])
    const key = name.toLocaleLowerCase()
    expect(icons.byFileName).toBeDefined()
    expect(Object.hasOwn(icons.byFileName ?? {}, key)).toBe(true)
    expect(icons.byFileName?.[key]).toEqual({
      name: 'app-vscode-icon-file-duo',
      token: 'default',
    })
  },
)
