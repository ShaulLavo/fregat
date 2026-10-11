import { build, createServer as createViteServer } from 'vite'
import { chromium, type Browser } from 'playwright'
import { createServer as allocateServer } from 'node:net'
import { createServer } from 'node:http'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
async function freePort() {
  const server = allocateServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}
export async function startCapture() {
  await mkdir(join(root, '.capture'), { recursive: true })
  await build({
    configFile: false,
    root,
    build: {
      outDir: '.capture/assets',
      emptyOutDir: true,
      rollupOptions: { input: join(root, 'scripts/capture.html') },
    },
  })
  // Middleware mode keeps Vite from installing process-exit signal handlers.
  const assets = await createViteServer({
    configFile: false,
    root: join(root, '.capture/assets'),
    server: { middlewareMode: true },
  })
  const assetServer = createServer(assets.middlewares)
  const assetPort = await freePort()
  await new Promise<void>((resolve) => assetServer.listen(assetPort, '127.0.0.1', resolve))
  let browser: Browser | undefined
  let api: ReturnType<typeof createServer> | undefined
  try {
    // The caller owns shutdown; Playwright's signal handlers would exit before its cleanup.
    browser = await chromium.launch({
      channel: 'chromium',
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    })
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.goto(`http://127.0.0.1:${assetPort}/scripts/capture.html`)
    await page.waitForFunction(() => 'capture' in window)
    let queue = Promise.resolve()
    const cache = new Map<string, string>()
    api = createServer((request, response) => {
      let input = ''
      request.on('data', (chunk) => {
        input += chunk
      })
      request.on('end', () => {
        queue = queue.then(async () => {
          try {
            let result = cache.get(input)
            if (!result) {
              const source = JSON.parse(input) as { text: string; language: string }
              const capture = await page.evaluate(async ({ text, language }) => {
                const run = (
                  window as unknown as {
                    capture(text: string, language: string, theme: string): Promise<unknown>
                  }
                ).capture
                return {
                  light: await run(text, language, 'light'),
                  dark: await run(text, language, 'dark'),
                }
              }, source)
              result = JSON.stringify(capture)
              cache.set(input, result)
            }
            response.setHeader('content-type', 'application/json')
            response.end(result)
          } catch (error) {
            response.statusCode = 500
            response.end(String(error))
          }
        })
      })
    })
    const port = await freePort()
    await new Promise<void>((resolve) => api!.listen(port, '127.0.0.1', resolve))
    await writeFile(
      join(root, '.capture/endpoint.json'),
      JSON.stringify(`http://127.0.0.1:${port}`),
    )
    return async () => {
      await browser!.close()
      await new Promise<void>((resolve) => api!.close(() => resolve()))
      await new Promise<void>((resolve) => assetServer.close(() => resolve()))
      await assets.close()
      await rm(join(root, '.capture/endpoint.json'))
      console.log(`Captured ${cache.size} distinct Singapore examples.`)
    }
  } catch (error) {
    await browser?.close()
    if (api?.listening) await new Promise<void>((resolve) => api!.close(() => resolve()))
    await new Promise<void>((resolve) => assetServer.close(() => resolve()))
    await assets.close()
    await rm(join(root, '.capture/endpoint.json'), { force: true })
    throw error
  }
}
