import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, test } from 'vitest'

const script = join(import.meta.dirname, 'web-layering.mjs')

test('census counts real imports and separates all test consumers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-layering-'))
  const files = {
    'src/lib/target.ts': 'export const value = 1',
    'src/features/one/component.tsx': "import { value } from '@/lib/target'",
    'src/features/two/helper.ts': "export { value } from '../../lib/target.ts'",
    'src/hooks/dynamic.ts': "import(`@/lib/target`); require('@/lib/target')",
    'src/hooks/types.ts':
      "type T = import('@/lib/target').Value; import V = require('@/lib/target')",
    'src/features/false/comment.ts': "// import { value } from '@/lib/target'",
    'src/features/false/string.ts': 'const text = "from \'@/lib/target\'"',
    'src/features/tested/tests/factories/fixture.ts': "import '@/lib/target'",
    'src/features/tested/tests/navigation.types.ts': "import '@/lib/target'",
    'src/features/tested/helper.test.ts': "import '@/lib/target'",
    'test/factories/shared.ts': "import { value } from '../../src/lib/target'",
  }
  try {
    await writeSources(root, files)
    const child = Bun.spawn([process.execPath, script, '--root', root, '@/lib/target'])
    const output = await new Response(child.stdout).text()
    expect(await child.exited).toBe(0)
    expect(JSON.parse(output)).toEqual([
      {
        module: '@/lib/target',
        importLines: 6,
        buckets: ['features/one', 'features/two', 'hooks'],
        outsideLibBuckets: ['features/one', 'features/two', 'hooks'],
        files: [
          'features/one/component.tsx',
          'features/two/helper.ts',
          'hooks/dynamic.ts',
          'hooks/types.ts',
        ],
        testFiles: [
          '../test/factories/shared.ts',
          'features/tested/helper.test.ts',
          'features/tested/tests/factories/fixture.ts',
          'features/tested/tests/navigation.types.ts',
        ],
      },
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

async function writeSources(root: string, files: Readonly<Record<string, string>>) {
  for (const [filename, source] of Object.entries(files)) {
    const target = join(root, filename)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, source)
  }
}
