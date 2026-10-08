import { expect, test } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { YAML } from 'bun'

const root = new URL('../../', import.meta.url)
const workflow = YAML.parse(await readFile(new URL('.github/workflows/ci.yml', root), 'utf8'))
const format = workflow.jobs.docs.steps.find((step) => step.name === 'Format')

const textFiles = [
  'md',
  'mdx',
  'json',
  'jsonc',
  'yml',
  'yaml',
  'ts',
  'tsx',
  'mts',
  'cts',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'css',
  'scss',
  'less',
  'html',
  'vue',
  'astro',
  'graphql',
  'gql',
].map((extension) => `docs/example.${extension}`)

test.each([
  ['image-only changes', ['docs/images/workbench.webp', 'docs/images/logo.svg'], []],
  ['empty changes', [], []],
  [
    'mixed changes',
    [
      'docs/images/workbench.webp',
      'docs/guide.md',
      'plans/a guide.mdx',
      'docs/line\nbreak.md',
      'docs/data.json',
      'docs/a.png',
    ],
    ['docs/guide.md', 'plans/a guide.mdx', 'docs/line\nbreak.md', 'docs/data.json'],
  ],
  ['supported text files', textFiles, textFiles],
])('docs format handles %s', async (_, files, expected) => {
  const directory = await mkdtemp(join(tmpdir(), 'docs-format-'))
  const output = join(directory, 'arguments')
  await writeFile(join(directory, 'bunx'), '#!/bin/sh\nprintf "%s\\0" "$@" > "$OUTPUT"\n', {
    mode: 0o755,
  })
  try {
    const result = spawnSync('bash', ['-euo', 'pipefail', '-c', format.run], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        FILES: JSON.stringify(files),
        OUTPUT: output,
      },
      encoding: 'utf8',
    })
    expect(result.status, result.stderr).toBe(0)
    const argumentsText = await readFile(output, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return ''
      throw error
    })
    const args = argumentsText.split('\0').filter(Boolean)
    if (expected.length === 0) {
      expect(args).toEqual([])
      return
    }
    expect(args).toEqual([
      `oxfmt@${JSON.parse(await readFile(new URL('package.json', root), 'utf8')).workspaces.catalog.oxfmt}`,
      '--check',
      ...expected.map((file) => `./${file}`),
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
