import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { build } from 'vite'
import { licenseNoticesPlugin } from './license-notices-plugin'

test('production builds emit licence notices without bundle accounting', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'license-notices-'))
  try {
    await writeFile(path.join(root, 'entry.js'), 'console.log("fixture")')
    await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [licenseNoticesPlugin()],
      build: { rolldownOptions: { input: path.join(root, 'entry.js') } },
    })
    const licenses = path.join(root, 'dist/licenses')
    expect(await readFile(path.join(licenses, 'THIRD_PARTY_NOTICES.txt'), 'utf8')).toContain(
      '@fontsource-variable/inter',
    )
    expect(await readFile(path.join(licenses, 'editor-grammars.txt'), 'utf8')).toContain(
      'Copyright',
    )
    expect((await readdir(root)).sort()).toEqual(['dist', 'entry.js'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
