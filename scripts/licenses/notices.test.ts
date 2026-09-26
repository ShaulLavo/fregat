import { mkdtemp, mkdir, writeFile, rm, symlink, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { packageNotices } from './notices'

test('keeps licence and nested notices, deduplicates symlinks, and orders packages deterministically', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'package-notices-'))
  try {
    const first = path.join(root, 'node_modules/alpha')
    const second = path.join(root, 'node_modules/beta')
    await mkdir(path.join(first, 'notices/grammars'), { recursive: true })
    await mkdir(second, { recursive: true })
    await writeFile(
      path.join(first, 'package.json'),
      JSON.stringify({ name: 'alpha', version: '1.0.0', license: 'MIT' }),
    )
    await writeFile(path.join(first, 'LICENSE'), 'Copyright Alpha\nMIT terms')
    await writeFile(path.join(first, 'notices/grammars/example.txt'), 'Grammar copyright')
    await writeFile(
      path.join(second, 'package.json'),
      JSON.stringify({ name: 'beta', version: '2.0.0', license: 'ISC' }),
    )
    await writeFile(path.join(second, 'LICENSE'), 'Copyright Beta\nISC terms')
    await symlink(first, path.join(root, 'node_modules/alias'))
    const files = [
      path.join(second, 'index.js'),
      path.join(first, 'index.js'),
      path.join(root, 'node_modules/alias/other.js'),
    ]
    const result = packageNotices(files)
    expect(result).toBe(packageNotices([...files].reverse()))
    expect(result.match(/alpha@1.0.0/g)).toHaveLength(1)
    expect(result).toContain('Copyright Alpha\nMIT terms')
    expect(result).toContain('Grammar copyright')
    expect(result).toContain('Licence: ISC')
    expect(result).toContain('Copyright Beta\nISC terms')
    expect(result.indexOf('alpha@')).toBeLessThan(result.indexOf('beta@'))
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test.each(['', '   \n'])('rejects missing or empty licence text', async (text) => {
  const root = await mkdtemp(path.join(tmpdir(), 'missing-notices-'))
  try {
    const directory = path.join(root, 'node_modules/unresolved')
    await mkdir(directory, { recursive: true })
    const manifest = path.join(directory, 'package.json')
    await writeFile(
      manifest,
      JSON.stringify({ name: 'unresolved', version: '1.0.0', license: 'MIT' }),
    )
    if (text) await writeFile(path.join(directory, 'LICENSE'), text)
    expect(() => packageNotices([manifest])).toThrow(
      'Missing full licence text for unresolved@1.0.0',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test.each([
  ['react-remove-scroll-bar', '2.3.8', 'Anton Korzunov'],
  ['rehype-katex', '7.0.1', 'Junyoung Choi'],
  ['remark-math', '6.0.0', 'Junyoung Choi'],
  ['drizzle-orm', '0.45.3', 'END OF TERMS AND CONDITIONS'],
  ['http_ece', '1.2.0', 'Martin Thomson'],
  ['standardwebhooks', '1.1.1', 'Svix'],
  ['woff2sfnt-sfnt2woff', '1.0.0', 'Onur Demiralay'],
])(
  'ships full reviewed terms for %s@%s when npm omits them',
  async (name, version, attribution) => {
    const root = await mkdtemp(path.join(tmpdir(), 'reviewed-notices-'))
    try {
      const directory = path.join(root, 'node_modules', name)
      await mkdir(directory, { recursive: true })
      const manifest = path.join(directory, 'package.json')
      await writeFile(manifest, JSON.stringify({ name, version }))
      const expected = await readFile(
        path.join(import.meta.dirname, 'texts', `${name}@${version}.txt`),
        'utf8',
      )
      const result = packageNotices([manifest])
      expect(result).toContain(expected.trim())
      expect(result).toContain(attribution)
      expect(result).toContain('AS IS')
      expect(result).not.toContain('contains no licence text')
      await writeFile(manifest, JSON.stringify({ name, version: '99.0.0' }))
      expect(() => packageNotices([manifest])).toThrow(
        `Missing full licence text for ${name}@99.0.0`,
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)
