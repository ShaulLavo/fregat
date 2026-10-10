import { build, preview } from 'vite'
import { chromium } from 'playwright'
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = join(root, '.capture')
const sources: [string, string][] = [
  ['hero.ts', (await readFile(join(root, 'src/examples/hero.ts'), 'utf8')).trimEnd()],
  ['install.sh', 'npm install @singapore-editor/core'],
]
for (const section of ['start-here', 'guides', 'concepts']) {
  const path = join(root, 'src/content/docs/docs', section)
  for (const name of (await readdir(path)).sort()) {
    if (name.endsWith('.md'))
      sources.push([`${section}/${name}`, await readFile(join(path, name), 'utf8')])
  }
}
const hash = createHash('sha256').update(JSON.stringify(sources))
async function fingerprint(path: string) {
  for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const name = join(path, entry.name)
    if (entry.isDirectory()) await fingerprint(name)
    else hash.update(name.replace(root, '')).update(await readFile(name))
  }
}
for (const path of [
  'src/manual',
  'src/fonts',
  'src/styles',
  'scripts/capture-page.ts',
  'scripts/capture.ts',
  'scripts/capture.html',
  'scripts/activate.ts',
  '../../bun.lock',
]) {
  const name = join(root, path)
  if (path.endsWith('.ts') || path.endsWith('.lock') || path.endsWith('.html'))
    hash.update(await readFile(name))
  else await fingerprint(name)
}
for (const entry of await readdir(join(root, '../packages'))) {
  await fingerprint(join(root, '../packages', entry, 'dist'))
}
const key = hash.digest('hex')
const output = join(directory, 'documents.json')
const cached = await readFile(output, 'utf8')
  .then(JSON.parse)
  .catch(() => null)
const activationReady = await readFile(join(directory, 'activation/activate.js'))
  .then(() => true)
  .catch(() => false)
if (cached?.key === key && activationReady) {
  console.log(`Using ${sources.length} qualified document captures.`)
  process.exit(0)
}
await mkdir(directory, { recursive: true })
await build({
  configFile: false,
  root,
  build: {
    outDir: '.capture/activation',
    emptyOutDir: true,
    lib: {
      entry: join(root, 'scripts/activate.ts'),
      name: 'SingaporeCapturedPaint',
      formats: ['iife'],
      fileName: () => 'activate.js',
    },
  },
})
await build({
  configFile: false,
  root,
  base: '/',
  build: {
    outDir: '.capture/assets',
    emptyOutDir: true,
    rollupOptions: { input: join(root, 'scripts/capture.html') },
  },
})
const server = await preview({
  configFile: false,
  root,
  base: '/',
  build: { outDir: '.capture/assets' },
  preview: { host: '127.0.0.1', port: 0, strictPort: true },
})
let browser
try {
  // The headless shell rounds font advances differently from the full browser.
  browser = await chromium.launch({ channel: 'chromium' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const ink = new Map<number, Buffer>()
  let label = ''
  await page.exposeFunction('qualifyCapture', async (stage: string, width: number) => {
    const overflow = await page.locator('#capture').evaluate((host) => {
      const elements = [
        host,
        ...host.querySelectorAll<HTMLElement>('.editor-virtualized, [data-editor-document-paint]'),
      ]
      return elements
        .filter(
          (element) => element.getClientRects().length && element.scrollWidth > element.clientWidth,
        )
        .map((element) => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }))
    })
    if (overflow.length)
      throw new TypeError(`${label}: ${stage} overflows at ${width}px: ${JSON.stringify(overflow)}`)
    const pixels = await page.locator('#capture').screenshot({
      style: '.editor-virtualized-caret-layer { visibility: hidden !important; }',
    })
    if (stage === 'live') {
      ink.set(width, pixels)
      return
    }
    if (pixels.equals(ink.get(width)!)) return
    const evidence = join(directory, 'evidence')
    await mkdir(evidence, { recursive: true })
    await writeFile(join(evidence, `${label}-${width}-live.png`), ink.get(width)!)
    await writeFile(join(evidence, `${label}-${width}-${stage}.png`), pixels)
    throw new TypeError(`${label}: ${stage} pixels changed at ${width}px; see ${evidence}`)
  })
  await page.goto(`${server.resolvedUrls!.local[0]}scripts/capture.html`)
  const documents: Record<string, unknown> = {}
  for (const [file, text] of sources) {
    const captures: Record<string, unknown> = {}
    for (const theme of ['light', 'dark'] as const) {
      label = `${file.replaceAll('/', '-')}-${theme}`
      ink.clear()
      captures[theme] = await page.evaluate(
        async ({ file, text, theme }) => {
          const capture = (
            window as unknown as {
              capture(file: string, text: string, theme: string): Promise<unknown>
            }
          ).capture
          return capture(file, text, theme)
        },
        { file, text, theme },
      )
    }
    documents[file] = { text, ...captures }
    console.log(`Captured ${file}`)
  }
  await writeFile(output, JSON.stringify({ key, documents }))
} finally {
  await browser?.close()
  await new Promise<void>((resolve, reject) =>
    server.httpServer.close((error) => (error ? reject(error) : resolve())),
  )
}
