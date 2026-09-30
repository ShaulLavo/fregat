import { createServer, type ServerResponse } from 'node:http'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { checkoutRoot } from './paths'

const cases = [
  { mode: 'healthy', code: 0, consoleCapture: true },
  { mode: 'module504', code: 1, consoleCapture: true },
  { mode: 'aborted-script', code: 1, consoleCapture: false },
  { mode: 'module-mime', code: 1, consoleCapture: true },
  { mode: 'runtime-error', code: 1, consoleCapture: true },
  { mode: 'load-during-release', code: 1, consoleCapture: true },
  { mode: 'release503', code: 1, consoleCapture: true },
] as const

test.each(cases)('doctor classifies $mode through the real CLI', async (fixture) => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'fregat-doctor-test-'))
  let releaseRequests = 0
  let heldScript: ServerResponse | undefined
  let heldRelease: ServerResponse | undefined
  const server = createServer((request, response) => {
    if (request.url === '/release' && fixture.mode === 'load-during-release') {
      releaseRequests += 1
      heldRelease = response
      heldScript?.writeHead(504, { 'content-type': 'text/javascript' }).end()
      return
    }
    if (request.url === '/failure-recorded') {
      heldRelease?.writeHead(200, { 'content-type': 'application/json' }).end('{}')
      response.writeHead(204).end()
      return
    }
    if (request.url === '/release') {
      releaseRequests += 1
      response.writeHead(fixture.mode === 'release503' ? 503 : 200, {
        'content-type': 'application/json',
      })
      response.end('{}')
      return
    }
    if (request.url === '/required.js' && fixture.mode === 'aborted-script') {
      response.destroy()
      return
    }
    if (request.url === '/required.js' && fixture.mode === 'load-during-release') {
      heldScript = response
      return
    }
    if (request.url === '/required.js') {
      response.writeHead(fixture.mode === 'module504' ? 504 : 200, {
        'content-type': fixture.mode === 'module-mime' ? 'text/html' : 'text/javascript',
      })
      response.end(
        fixture.mode === 'runtime-error'
          ? 'throw new Error("Fixture startup failed")'
          : 'document.querySelector("[aria-label]").textContent = "Fully loaded"',
      )
      return
    }
    if (request.url === '/favicon.ico') {
      response.writeHead(204).end()
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(
      fixture.mode === 'load-during-release'
        ? `<!doctype html><title>Doctor fixture</title><div aria-label="Window toolbar">Partial shell</div><script type="module" async src="/required.js" onerror="fetch('/failure-recorded')"></script>`
        : '<!doctype html><title>Doctor fixture</title><div aria-label="Window toolbar">Partial shell</div><script type="module" src="/required.js"></script>',
    )
  })
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') expect.fail('Expected a private HTTP port')
    const url = `http://127.0.0.1:${address.port}/`
    const child = Bun.spawn(
      [
        'bun',
        'scripts/agent/browser.ts',
        'look',
        '--doctor',
        '--url',
        url,
        ...(fixture.consoleCapture ? [] : ['--no-console']),
      ],
      {
        cwd: checkoutRoot,
        env: {
          ...process.env,
          WEB_PORT: '5173',
          FREGAT_EVIDENCE_ROOT: scratch,
          OBSERVABILITY_DIR: path.join(scratch, 'logs'),
          PLATFORM_HOME: path.join(scratch, 'home'),
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    const [run] = await readdir(scratch)
    if (!run) expect.fail(stdout + stderr)
    const observed = JSON.parse(await readFile(path.join(scratch, run, 'observed.json'), 'utf8'))
    expect(releaseRequests).toBe(1)
    if (fixture.mode === 'module504' || fixture.mode === 'load-during-release') {
      expect(observed.failedResponses).toContainEqual({
        url: `${url}required.js`,
        status: 504,
        type: 'script',
      })
    }
    if (fixture.mode === 'aborted-script') {
      expect(observed.failedRequests).toContainEqual(
        expect.objectContaining({ url: `${url}required.js` }),
      )
      expect(observed.errors).toEqual([])
      expect(observed.consoleCapture).toBe(false)
    }
    if (fixture.mode === 'module-mime') {
      expect(observed.failedResponses).toEqual([])
      expect(observed.consoleErrors.join('\n')).toContain('MIME')
      expect(observed.consoleDetails).toContainEqual(
        expect.objectContaining({ level: 'error', url: `${url}required.js` }),
      )
    }
    if (fixture.mode === 'runtime-error')
      expect(observed.errors).toContain('Fixture startup failed')
    expect({ code, health: observed.health }, stdout + stderr).toMatchObject({
      code: fixture.code,
      health: { ok: fixture.code === 0 },
    })
    if (fixture.mode === 'healthy') {
      expect(observed.health.reasons).toEqual([])
      expect(observed.assets).toContain(`${url}required.js`)
      expect(observed.errors).toEqual([])
      expect(observed.failedRequests).toEqual([])
      expect(observed.failedResponses).toEqual([])
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
    await rm(scratch, { recursive: true, force: true })
  }
})
