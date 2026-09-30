import { readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { build, type PluginOption } from 'vite'
import type { Page } from 'playwright'

export async function buildChatProof(options: {
  app: string
  base: string
  bundle: string
  entry: string
  server: string
  plugins?: PluginOption[]
}) {
  await build({
    configFile: false,
    root: options.app,
    base: options.base,
    logLevel: 'error',
    plugins: [react(), tailwindcss(), ...(options.plugins ?? [])],
    resolve: { alias: { '@': resolve(options.app, 'src') }, dedupe: ['react', 'react-dom'] },
    define: { 'import.meta.env.VITE_SERVER_URL': JSON.stringify(options.server) },
    worker: { format: 'es' },
    build: {
      outDir: options.bundle,
      emptyOutDir: true,
      cssCodeSplit: false,
      minify: false,
      rollupOptions: { input: options.entry, output: { entryFileNames: 'proof.js' } },
    },
  })
  const css = (await readdir(resolve(options.bundle, 'assets'))).find((name) =>
    name.endsWith('.css'),
  )
  await writeFile(
    resolve(options.bundle, 'index.html'),
    `<html class="dark"><head><link rel="stylesheet" href="./assets/${css}"></head><body><div id="proof-root"></div><script type="module" src="./proof.js"></script></body></html>`,
  )
}

export async function captureChatProofFailure(
  page: Page,
  artifacts: string,
  errors: readonly string[],
) {
  await page.screenshot({ path: resolve(artifacts, 'failed.png') })
  const failure = { errors, content: await page.locator('body').innerText() }
  await writeFile(resolve(artifacts, 'failed.json'), JSON.stringify(failure, null, 2))
  console.error(JSON.stringify(failure))
}

export async function writeChatProofResult(artifacts: string, result: unknown) {
  await writeFile(resolve(artifacts, 'proof.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
}
