import { existsSync } from 'node:fs'
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { createLogger, createServer } from 'vite'
import { expect, test } from 'vitest'
import { checkoutRoot, evidenceRoot as retainedEvidenceRoot } from './paths'
import { isPortAvailable, selectAvailablePort } from '../runtime-network'

test('cold dev startup loads Settings without replacing the optimizer graph', async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'fregat-vite-startup-'))
  const evidenceRoot = path.join(scratch, 'evidence')
  const retainedEvidence = path.join(retainedEvidenceRoot, path.basename(scratch))
  // Playwright's installed cache belongs to the original home, even with an isolated font cache.
  const cacheRoots: Partial<Record<NodeJS.Platform, string>> = {
    darwin: path.join(homedir(), 'Library', 'Caches'),
    win32: process.env.LOCALAPPDATA ?? path.join(homedir(), 'AppData', 'Local'),
  }
  const browserCache =
    process.env.PLAYWRIGHT_BROWSERS_PATH ??
    path.join(
      cacheRoots[process.platform] ?? process.env.XDG_CACHE_HOME ?? path.join(homedir(), '.cache'),
      'ms-playwright',
    )
  // This checks the cold optimizer graph; its optional font comes from an offline fixture.
  const fontCache = path.join(scratch, '.platform', 'fonts', 'files')
  await mkdir(fontCache, { recursive: true })
  await copyFile(
    path.join(checkoutRoot, 'apps/web/demo-assets/fonts/JetBrainsMonoNerdFont-Regular.ttf'),
    path.join(fontCache, 'NerdFontsSymbolsOnly.ttf'),
  )
  const port = await selectAvailablePort({
    preferredPort: 5493,
    isAvailable: async (candidate) =>
      (await isPortAvailable('127.0.0.1', candidate)) &&
      (await isPortAvailable('127.0.0.1', 33_400 + (candidate % 100) * 10)),
  })
  const messages: string[] = []
  const logger = createLogger('silent')
  logger.info = (message) => messages.push(message)
  const server = await createServer({
    root: path.join(checkoutRoot, 'apps/web'),
    configFile: path.join(checkoutRoot, 'apps/web/vite.config.ts'),
    cacheDir: path.join(scratch, 'vite-cache'),
    customLogger: logger,
    server: { host: '127.0.0.1', port, strictPort: true },
  })
  let child: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined
  let passed = false
  try {
    await server.listen()
    child = Bun.spawn(
      ['bun', 'scripts/agent/browser.ts', 'scenario', 'settings-tokenization-limit'],
      {
        cwd: checkoutRoot,
        env: {
          ...process.env,
          HOME: scratch,
          USERPROFILE: scratch,
          ...(existsSync(browserCache) ? { PLAYWRIGHT_BROWSERS_PATH: browserCache } : {}),
          OBSERVABILITY_ENABLED: 'true',
          WEB_PORT: String(port),
          FREGAT_EVIDENCE_ROOT: evidenceRoot,
        },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    const [run] = await readdir(evidenceRoot)
    if (!run) expect.fail(stdout + stderr)
    const observed = JSON.parse(
      await readFile(path.join(evidenceRoot, run, 'observed.json'), 'utf8'),
    )
    const diagnostic = `${stdout}${stderr}\nVite: ${messages.join('\n')}\nFailed-run evidence: ${retainedEvidence}`
    expect(
      {
        code,
        failure: observed.failure,
        optimizerReloads: messages.filter((message) =>
          message.includes('optimized dependencies changed'),
        ),
        errors: observed.errors,
        consoleErrors: observed.consoleErrors,
        failedResponses: observed.failedResponses,
      },
      diagnostic,
    ).toEqual({
      code: 0,
      failure: null,
      optimizerReloads: [],
      errors: [],
      consoleErrors: [],
      failedResponses: [],
    })
    passed = true
  } finally {
    if (!passed) await cp(evidenceRoot, retainedEvidence, { recursive: true }).catch(() => {})
    if (child?.exitCode === null) {
      child.kill()
      await child.exited
    }
    await server.close()
    await rm(scratch, { recursive: true, force: true })
  }
}, 60_000)
