import { expect, test } from 'vitest'
import { readFile, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../../', import.meta.url)
const family = new URL('packages/ghostty-webgpu/', root)
const classic = new URL('site-classic/', family)
const scene = new URL('site/', family)
const text = (url) => readFile(url, 'utf8')

for (const path of [
  'src/content/docs',
  'src/examples',
  'src/components/EchoTerminal.astro',
  'src/measurements.ts',
  'src/correctness.ts',
  'src/site-links.ts',
]) {
  test(`classic reads the shared ${path} source`, async () => {
    expect(await realpath(new URL(path, classic))).toBe(await realpath(new URL(path, scene)))
  })
}

test('Pages publishes the classic output while the Worker builds the scene site', async () => {
  const pages = await text(new URL('.github/workflows/site.yml', family))
  expect(pages).toContain('bun run site:classic:build --base /ghostty-webgpu/')
  expect(pages).toContain('path: site-classic/dist')
  expect(pages).toContain("- 'docs/**'")
  const manifest = JSON.parse(await text(new URL('package.json', family)))
  expect(manifest.workspaces.packages).toEqual(expect.arrayContaining(['site', 'site-classic']))
  expect(manifest.scripts['site:classic:build']).toBe('bun run --cwd site-classic build')
  const workerBuild = await text(new URL('scripts/product-sites/build.sh', root))
  expect(workerBuild).toContain('bun run --cwd packages/ghostty-webgpu/site build --base /')
  expect(workerBuild).not.toContain('site-classic')
})

test('site compilers and browser examples resolve the standalone package root', async () => {
  for (const site of [scene, classic]) {
    const manifest = JSON.parse(await text(new URL('package.json', site)))
    expect(manifest.dependencies?.['ghostty-webgpu']).toBeUndefined()
    expect(manifest.scripts.typecheck).toContain('../node_modules/.bin/tsc')
    expect(await text(new URL('astro.config.ts', site))).toContain('alias: packageAliases')
  }
  expect(await text(new URL('scripts/package-aliases.ts', scene))).toContain('../../dist/index.js')
})

test('both editions keep their footer link to the other edition', async () => {
  expect(await text(new URL('src/pages/index.astro', classic))).toContain(
    '<a href="https://ghostty.shaulavo.dev/">Scene edition</a>',
  )
  expect(await text(new URL('src/pages/index.astro', scene))).toContain(
    '<a href="https://shaullavo.github.io/ghostty-webgpu/">Classic edition</a>',
  )
})

test('the mirror includes both site trees without filtering their shared paths', async () => {
  const workflow = await text(new URL('.github/workflows/mirror.yml', root))
  expect(workflow).toContain('folder: packages/ghostty-webgpu')
  expect(workflow).toContain('split --prefix="$FAMILY_FOLDER" HEAD')
  expect(await realpath(new URL('src/content/docs', classic))).toBe(
    fileURLToPath(new URL('src/content/docs', scene)).replace(/\/$/, ''),
  )
})
