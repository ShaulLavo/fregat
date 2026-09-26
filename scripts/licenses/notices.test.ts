import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
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
    expect(result).toContain('contains no licence text')
    expect(result.indexOf('alpha@')).toBeLessThan(result.indexOf('beta@'))
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
