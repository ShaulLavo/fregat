import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'

const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
const families = [
  {
    name: 'hotkeys',
    packages: /^@fregat\//,
    asset:
      /^https:\/\/github\.com\/ShaulLavo\/hotkeys\/releases\/download\/hotkeys-[0-9a-f]{40}\/[\w.-]+\.tgz$/,
  },
  {
    name: 'Singapore',
    packages: /^@singapore-editor\//,
    asset:
      /^https:\/\/github\.com\/ShaulLavo\/singapore\/releases\/download\/singapore-[0-9a-f]{40}\/[\w.-]+\.tgz$/,
  },
  {
    name: 'Ghostty',
    packages: /^ghostty-webgpu(?:-|$)/,
    asset:
      /^https:\/\/github\.com\/ShaulLavo\/ghostty-webgpu\/releases\/download\/v\d+\.\d+\.\d+-[0-9a-f]{7,40}\/[\w.-]+\.tgz$/,
  },
]

test.each(families)(
  '$name catalog and override pins use commit-qualified release assets',
  (family) => {
    const catalog = manifest.workspaces.catalog
    const pins = Object.entries(catalog)
      .concat(Object.entries(manifest.overrides))
      .filter(([name]) => family.packages.test(name))
    expect(pins.length).toBeGreaterThan(0)
    for (const [name, specifier] of pins) {
      const resolved = specifier === 'catalog:' ? catalog[name] : specifier
      expect(resolved, name).toMatch(family.asset)
    }
  },
)

test('the consumer declares the Node runtime required by its released parsers', () => {
  expect(Bun.semver.satisfies('26.0.0', manifest.engines.node)).toBe(true)
  expect(Bun.semver.satisfies('25.9.0', manifest.engines.node)).toBe(false)
})
