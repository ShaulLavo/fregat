import { createServer, type ServerResponse } from 'node:http'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, onTestFailed, test } from 'vitest'
import { checkoutRoot } from './paths'
import { chromiumUnavailable } from './browser-prerequisites'

const it = test.skipIf(chromiumUnavailable)

const cases = [
  { mode: 'healthy', code: 0, consoleCapture: true },
  { mode: 'nested-address', code: 0, consoleCapture: true },
  { mode: 'nested-root-address', code: 0, consoleCapture: true },
  { mode: 'delayed-startup', code: 0, consoleCapture: true },
  { mode: 'delayed-startup-error', code: 1, consoleCapture: true },
  { mode: 'startup-busy', code: 1, consoleCapture: true },
  { mode: 'startup-unmarked', code: 1, consoleCapture: true },
  { mode: 'module504', code: 1, consoleCapture: true },
  { mode: 'aborted-script', code: 1, consoleCapture: false },
  { mode: 'module-mime', code: 1, consoleCapture: true },
  { mode: 'stylesheet-mime', code: 1, consoleCapture: true },
  { mode: 'cancelled-iframe-script', code: 0, consoleCapture: true },
  { mode: 'runtime-error', code: 1, consoleCapture: true },
  { mode: 'runtime-error-no-console', code: 1, consoleCapture: false },
  { mode: 'load-during-release', code: 1, consoleCapture: true },
  { mode: 'release503', code: 1, consoleCapture: true },
] as const

type PipeFacts = { bytes: number; complete: boolean }
type RequestFacts = { resource: string; status: number | null; complete: boolean }

function fixtureResource(url: string | undefined) {
  switch (url) {
    case '/required.js':
    case '/deferred.js':
    case '/frame.js':
    case '/frame-ready':
    case '/required.css':
    case '/failure-recorded':
    case '/favicon.ico':
      return url.slice(1)
    case '/release':
    case '/platform/release':
      return 'release'
    default:
      return 'document'
  }
}

function recordRequest(
  url: string | undefined,
  response: ServerResponse,
  requests: RequestFacts[],
) {
  if (requests.length >= 16) return
  const facts: RequestFacts = {
    resource: fixtureResource(url),
    status: null,
    complete: false,
  }
  requests.push(facts)
  response.once('finish', () => {
    facts.status = response.statusCode
    facts.complete = true
  })
}

async function readPipe(stream: ReadableStream<Uint8Array>, facts: PipeFacts) {
  const counted = stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        facts.bytes += chunk.byteLength
        controller.enqueue(chunk)
      },
    }),
  )
  const text = await new Response(counted).text()
  facts.complete = true
  return text
}

it.each(cases)('doctor classifies $mode through the real CLI', async (fixture) => {
  const started = performance.now()
  let completed = 'started'
  let failedAfter: string | undefined
  let child: Pick<Bun.Subprocess, 'pid' | 'exitCode' | 'signalCode'> | undefined
  const pipes = {
    stdout: { bytes: 0, complete: false },
    stderr: { bytes: 0, complete: false },
  }
  const requests: RequestFacts[] = []
  let requestCount = 0
  onTestFailed(() => {
    console.error(
      JSON.stringify({
        event: 'doctor-fixture-failure',
        mode: fixture.mode,
        elapsedMs: Math.round(performance.now() - started),
        completed,
        failedAfter: failedAfter ?? completed,
        child: child
          ? { pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode }
          : null,
        pipes,
        requestCount,
        omittedRequests: requestCount - requests.length,
        requests,
      }),
    )
  })
  const scratch = await mkdtemp(path.join(tmpdir(), 'fregat-doctor-test-'))
  completed = 'scratch-created'
  let releaseRequests = 0
  let startupCompleted = false
  let startupTimer: ReturnType<typeof setTimeout> | undefined
  let heldScript: ServerResponse | undefined
  let heldRelease: ServerResponse | undefined
  const frameReady = Promise.withResolvers<void>()
  const server = createServer((request, response) => {
    requestCount += 1
    recordRequest(request.url, response, requests)
    if (request.url === '/deferred.js') {
      startupTimer = setTimeout(() => {
        startupCompleted = true
        response
          .writeHead(200, { 'content-type': 'text/javascript' })
          .end(
            fixture.mode === 'delayed-startup-error' || fixture.mode === 'startup-unmarked'
              ? 'throw new Error("Deferred startup failed")'
              : 'const shell = document.querySelector("[aria-label]"); shell.textContent = "Fully loaded"; shell.ariaBusy = "false"',
          )
      }, 850)
      return
    }
    if (request.url === '/frame.js') {
      frameReady.resolve()
      return
    }
    if (request.url === '/frame-ready') {
      void frameReady.promise.then(() => response.writeHead(200).end())
      return
    }
    if (request.url === '/required.css') {
      response
        .writeHead(200, {
          'content-type': 'text/html',
          'x-content-type-options': 'nosniff',
        })
        .end('Fixture stylesheet')
      return
    }
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
    if (request.url === '/release' || request.url === '/platform/release') {
      releaseRequests += 1
      response.writeHead(fixture.mode === 'release503' ? 503 : 200, {
        'content-type': 'application/json',
      })
      response.end('{}')
      return
    }
    if (request.url?.includes('/release')) {
      response.writeHead(404).end()
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
        fixture.mode === 'runtime-error' || fixture.mode === 'runtime-error-no-console'
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
    const extra: Record<string, string> = {
      'stylesheet-mime': '<link rel="stylesheet" href="/required.css">',
      'cancelled-iframe-script':
        '<iframe srcdoc="<script async src=/frame.js></script>"></iframe><script type="module">await fetch("/frame-ready"); document.querySelector("iframe").remove()</script>',
    }
    const deferred =
      fixture.mode === 'delayed-startup' ||
      fixture.mode === 'delayed-startup-error' ||
      fixture.mode === 'startup-unmarked'
    let script = '<script type="module" src="/required.js"></script>'
    if (deferred) script = '<script type="module">import("/deferred.js")</script>'
    if (fixture.mode === 'load-during-release')
      script = `<script type="module" async src="/required.js" onerror="fetch('/failure-recorded')"></script>`
    let busy = 'aria-busy="false"'
    if (deferred || fixture.mode === 'startup-busy') busy = 'aria-busy="true"'
    if (fixture.mode === 'startup-unmarked') busy = ''
    response.end(
      `<!doctype html><title>Doctor fixture</title><div aria-label="Window toolbar" ${busy}>Partial shell</div>${extra[fixture.mode] ?? ''}${script}`,
    )
  })
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    completed = 'fixture-listening'
    const address = server.address()
    if (!address || typeof address === 'string') expect.fail('Expected a private HTTP port')
    const base = `http://127.0.0.1:${address.port}`
    let url = `${base}/`
    if (fixture.mode === 'nested-address')
      url = `${base}/platform/~fixture/workbench/f/file.ts?tabs=@`
    if (fixture.mode === 'nested-root-address') url = `${base}/~fixture/workbench/f/file.ts?tabs=@`
    const spawned = Bun.spawn(
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
    child = spawned
    completed = 'cli-spawned'
    const [code, stdout, stderr] = await Promise.all([
      spawned.exited,
      readPipe(spawned.stdout, pipes.stdout),
      readPipe(spawned.stderr, pipes.stderr),
    ])
    completed = 'child-and-pipes-settled'
    const [run] = await readdir(scratch)
    completed = 'evidence-listed'
    if (!run) expect.fail(stdout + stderr)
    const observed = JSON.parse(await readFile(path.join(scratch, run, 'observed.json'), 'utf8'))
    completed = 'observation-parsed'
    expect(releaseRequests).toBe(1)
    if (
      fixture.mode === 'delayed-startup' ||
      fixture.mode === 'delayed-startup-error' ||
      fixture.mode === 'startup-unmarked'
    ) {
      expect(startupCompleted).toBe(true)
      expect(observed.assets).toContain(`${url}deferred.js`)
    }
    if (fixture.mode === 'delayed-startup-error' || fixture.mode === 'startup-unmarked')
      expect(observed.errors).toContain('Deferred startup failed')
    if (fixture.mode === 'startup-busy' || fixture.mode === 'startup-unmarked')
      expect(observed.health.reasons).toContain('initial content did not become ready')
    if (fixture.mode === 'module504' || fixture.mode === 'load-during-release') {
      expect(observed.failedResponses).toContainEqual({
        url: `${url}required.js`,
        status: 504,
        type: 'script',
      })
    }
    if (fixture.mode === 'aborted-script') {
      expect(observed.failedRequests).toContainEqual(
        expect.objectContaining({ url: `${url}required.js`, frameUrl: url, frameDetached: false }),
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
    if (fixture.mode === 'stylesheet-mime' || fixture.mode === 'cancelled-iframe-script') {
      const resource = fixture.mode === 'stylesheet-mime' ? 'required.css' : 'frame.js'
      expect(observed.failedRequests).toContainEqual(
        expect.objectContaining({
          url: `${url}${resource}`,
          error: 'net::ERR_ABORTED',
          frameUrl: fixture.mode === 'stylesheet-mime' ? url : 'about:srcdoc',
          frameDetached: fixture.mode === 'cancelled-iframe-script',
        }),
      )
      expect(observed.errors).toEqual([])
      expect(observed.failedResponses).toEqual([])
    }
    if (fixture.mode === 'stylesheet-mime') {
      expect(observed.consoleErrors.join('\n')).toContain('MIME')
      expect(observed.consoleDetails).toContainEqual(
        expect.objectContaining({ level: 'error', url }),
      )
    }
    if (fixture.mode === 'cancelled-iframe-script') {
      expect(observed.consoleErrors).toEqual([])
      expect(observed.assets).toContain(`${url}required.js`)
    }
    if (fixture.mode === 'runtime-error' || fixture.mode === 'runtime-error-no-console')
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
    completed = 'assertions-complete'
  } catch (error) {
    failedAfter = completed
    throw error
  } finally {
    clearTimeout(startupTimer)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
    completed = 'fixture-closed'
    await rm(scratch, { recursive: true, force: true })
    completed = 'scratch-removed'
  }
})
