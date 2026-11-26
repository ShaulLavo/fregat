import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'

const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const families = [
  {
    name: 'hotkeys',
    packages: /^@shaulavo\/hotkeys$/,
    specifier: EXACT_SEMVER,
  },
  {
    name: 'Singapore',
    packages: /^@singapore-editor\//,
    specifier: EXACT_SEMVER,
  },
  {
    name: 'Ghostty',
    packages: /^ghostty-webgpu(?:-|$)/,
    specifier: EXACT_SEMVER,
  },
]

test.each(families)('$name catalog and override pins use exact published versions', (family) => {
  const catalog = manifest.workspaces.catalog
  const pins = Object.entries(catalog)
    .concat(Object.entries(manifest.overrides))
    .filter(([name]) => family.packages.test(name))
  expect(pins.length).toBeGreaterThan(0)
  for (const [name, specifier] of pins) {
    const resolved = specifier === 'catalog:' ? catalog[name] : specifier
    expect(resolved, name).toMatch(family.specifier)
  }
})

test('the consumer declares the Node runtime required by its released parsers', () => {
  expect(Bun.semver.satisfies('26.0.0', manifest.engines.node)).toBe(true)
  expect(Bun.semver.satisfies('25.9.0', manifest.engines.node)).toBe(false)
})
