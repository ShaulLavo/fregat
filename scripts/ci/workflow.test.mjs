import { expect, test } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { YAML } from 'bun'

const root = new URL('../../', import.meta.url)
const workflow = YAML.parse(await readFile(new URL('.github/workflows/ci.yml', root), 'utf8'))
const format = workflow.jobs.docs.steps.find((step) => step.name === 'Format')
const manifest = await readFile(new URL('package.json', root), 'utf8')
const oxfmt = fileURLToPath(new URL('node_modules/.bin/oxfmt', root))

const images = {
  'docs/images/workbench.webp': Buffer.from([0, 255, 0, 128]),
  'docs/images/logo.svg': '<svg></svg>',
}

test.each([
  ['image-only changes', images, 0],
  ['empty changes', {}, 0],
  ['unsupported Astro', { 'docs/example.astro': '<div>unsupported' }, 0],
  ['unformatted JSON5', { 'docs/example.json5': '{answer:42}' }, 123],
  ['unformatted Markdown alias', { 'docs/example.markdown': '# Heading' }, 123],
  ['mixed changes with unformatted text', { ...images, 'docs/example.json5': '{answer:42}' }, 123],
  [
    'mixed formatted changes and unusual filenames',
    {
      ...images,
      'docs/example.astro': '<div>unsupported',
      'docs/guide.md': '# Guide\n',
      'plans/a guide.mdx': '# Guide\n',
      'docs/line\nbreak.markdown': '# Guide\n',
    },
    0,
  ],
])('docs format handles %s', async (_, fixtures, expectedStatus) => {
  const directory = await mkdtemp(join(tmpdir(), 'docs-format-'))
  const output = join(directory, 'arguments')
  try {
    await writeFile(join(directory, 'package.json'), manifest)
    await writeFile(
      join(directory, 'bunx'),
      '#!/bin/sh\nprintf "%s\\0" "$@" > "$OUTPUT"\nshift\nexec "$OXFMT" "$@"\n',
      { mode: 0o755 },
    )
    for (const [file, content] of Object.entries(fixtures)) {
      await mkdir(dirname(join(directory, file)), { recursive: true })
      await writeFile(join(directory, file), content)
    }
    const result = spawnSync('bash', ['-euo', 'pipefail', '-c', format.run], {
      cwd: directory,
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        FILES: JSON.stringify(Object.keys(fixtures)),
        OUTPUT: output,
        OXFMT: oxfmt,
      },
      encoding: 'utf8',
    })
    expect(result.status, result.stdout + result.stderr).toBe(expectedStatus)
    if (Object.keys(fixtures).length === 0) {
      await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' })
      return
    }
    const args = (await readFile(output, 'utf8')).split('\0').filter(Boolean)
    expect(args).toEqual(
      [
        `oxfmt@${JSON.parse(manifest).workspaces.catalog.oxfmt}`,
        '--check',
        '--no-error-on-unmatched-pattern',
      ].concat(Object.keys(fixtures).map((file) => `./${file}`)),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
