import assert from 'node:assert/strict'
import { accessSync, constants, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { resolveBrowserCandidates } from '../src/launcher/browser'
import { launchChromium, type ChromiumWindow } from '../src/launcher/chromium'
import { cdpPipe } from '../src/launcher/cdp'
import { launcherFailureFacts } from '../src/launcher/failure'
import { startupProcessCounters } from '../src/launcher/diagnostics'
import { launchWebview } from '../src/launcher/native-window'
import { macProcessAlive as alive } from './mac-process'
import { runNativeDialog } from '../src/launcher/webview-host'

if (process.argv.includes('--chromium-only')) {
  await import('./verify-chromium-macos')
  process.exit(0)
}

// Run only in the approved scratch directory; all services and browsing state belong to this probe.
assert.equal(process.platform, 'darwin')
const scratch = process.argv[2]!
assert.ok(path.isAbsolute(scratch) && scratch.startsWith('/Users/shaul/tmp/fregat-g3-'))
const binary = path.join(scratch, 'platform-webview')
const fixtures = path.join(scratch, 'browser.mjs')
const native = { binary, budget: { dialogMs: 2000, stopGraceMs: 1000 } }
const pids = new Set<number>()
const events: Record<string, unknown>[] = []
const failures: unknown[] = []
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch: () =>
    new Response('<!doctype html><title>Gate3 fixture</title><h1>Gate3 fixture</h1>', {
      headers: { 'Content-Type': 'text/html' },
    }),
})
const url = `http://127.0.0.1:${server.port}/`
const observe = (pid: number) => {
  pids.add(pid)
  return startupProcessCounters(pid)
}
const emit = (event: Record<string, unknown>) => {
  events.push(event)
  console.log(JSON.stringify(event))
}
const until = async (check: () => Promise<boolean>, limitMs = 5000) => {
  const end = Date.now() + limitMs
  while (Date.now() < end) {
    if (await check()) return
    await Bun.sleep(50)
  }
  assert.fail('Fixture condition timed out')
}

try {
  emit({
    stage: 'fixture',
    scratch,
    port: server.port,
    platform: process.platform,
    startupObservation: 'cdp-only',
  })
  for (const mode of ['silent', 'progress-forever']) {
    let pid = 0
    const started = performance.now()
    await assert.rejects(
      launchChromium({
        candidate: {
          kind: 'chromium',
          executable: process.execPath,
          args: [fixtures, mode, path.join(scratch, `${mode}.pid`)],
          confinement: 'none',
          source: 'setting',
          family: 'fixture',
        },
        stateHome: path.join(scratch, mode),
        home: scratch,
        url,
        startup: { idleMs: 250, limitMs: 1000 },
        native,
        observe: (value) => {
          pid = value
          return observe(value)
        },
        onOpen: () => assert.fail('Silent fixture opened'),
        onFailure: () => {},
      }),
      (error: unknown) => {
        const facts = (error as { internal: { reason: string; startupObservation: string } })
          .internal
        assert.equal(facts.reason, 'startup-stalled')
        assert.equal(facts.startupObservation, 'cdp-only')
        return true
      },
    )
    assert.ok(pid > 0 && !alive(pid))
    emit({
      stage: 'idle-cleanup',
      mode,
      pid,
      elapsedMs: Math.round(performance.now() - started),
      alive: alive(pid),
    })
  }
  // Incoming frames advance idle, while the absolute cap still ends an unresponsive version request.
  let capPid = 0
  const capStarted = performance.now()
  let capFacts: Record<string, unknown> = {}
  await assert.rejects(
    launchChromium({
      candidate: {
        kind: 'chromium',
        executable: process.execPath,
        args: [fixtures, 'cdp-progress', path.join(scratch, 'cap.pid')],
        confinement: 'none',
        source: 'setting',
        family: 'fixture',
      },
      stateHome: path.join(scratch, 'cap'),
      home: scratch,
      url,
      startup: { idleMs: 250, limitMs: 800 },
      native,
      observe: (value) => {
        capPid = value
        return observe(value)
      },
      onOpen: () => assert.fail('Cap fixture opened'),
      onFailure: () => {},
    }),
    (error: unknown) => {
      capFacts = (error as { internal: Record<string, unknown> }).internal
      return capFacts.reason === 'startup-limit'
    },
  )
  assert.ok(capPid > 0 && !alive(capPid))
  emit({
    stage: 'cap-cleanup',
    pid: capPid,
    alive: alive(capPid),
    elapsedMs: Math.round(performance.now() - capStarted),
    reason: capFacts.reason,
    startupPhase: capFacts.startupPhase,
    startupObservation: capFacts.startupObservation,
  })

  const candidates = resolveBrowserCandidates(
    'auto',
    'compositor',
    { home: '/Users/shaul', path: process.env.PATH ?? '', platform: 'darwin' },
    {
      readFile: (file) => {
        try {
          return readFileSync(file, 'utf8')
        } catch {
          return undefined
        }
      },
      exists: (file) => {
        try {
          accessSync(file, constants.X_OK)
          return true
        } catch {
          return false
        }
      },
    },
  )
  emit({ stage: 'discovery', candidates })
  for (const family of ['helium', 'chrome']) {
    const candidate = candidates.find(
      (entry) => entry.kind === 'chromium' && entry.family === family,
    )
    assert.ok(candidate?.kind === 'chromium', `${family} missing`)
    const baseline = Bun.spawn({
      cmd: [
        candidate.executable,
        '--headless',
        `--user-data-dir=${path.join(scratch, family, 'baseline')}`,
        '--remote-debugging-pipe',
        '--no-first-run',
        url,
      ],
      stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
    })
    pids.add(baseline.pid)
    const baselineCdp = cdpPipe(baseline.stdio[3] as number, baseline.stdio[4] as number)
    try {
      emit({
        stage: 'plain-headless-version',
        family,
        version: await baselineCdp.request('Browser.getVersion'),
      })
      const baselineTargets = await baselineCdp.request('Target.getTargets')
      emit({ stage: 'plain-headless-initial', family, targets: baselineTargets })
      const baselinePage = (
        baselineTargets.targetInfos as { type: string; targetId: string }[]
      ).find((entry) => entry.type === 'page')
      if (baselinePage) {
        const attached = await baselineCdp.request('Target.attachToTarget', {
          targetId: baselinePage.targetId,
          flatten: true,
        })
        baselineCdp.on('Network.loadingFailed', (event) =>
          emit({ stage: 'plain-headless-network-failed', family, params: event.params }),
        )
        await baselineCdp.request('Network.enable', {}, attached.sessionId as string)
        emit({
          stage: 'plain-headless-frame',
          family,
          frame: await baselineCdp.request('Page.getFrameTree', {}, attached.sessionId as string),
        })
        emit({
          stage: 'plain-headless-document',
          family,
          document: await baselineCdp.request(
            'Runtime.evaluate',
            {
              expression:
                'JSON.stringify({url:location.href,title:document.title,ready:document.readyState})',
              returnByValue: true,
            },
            attached.sessionId as string,
          ),
        })
      }
      await until(async () => {
        const targets = await baselineCdp.request('Target.getTargets')
        const infos = targets.targetInfos as { url: string; title: string }[]
        if (!infos.some((entry) => entry.url === url && entry.title === 'Gate3 fixture'))
          return false
        emit({ stage: 'plain-headless-targets', family, targets })
        return true
      })
    } catch (error) {
      emit({
        stage: 'plain-headless-unconfirmed',
        family,
        targets: await baselineCdp.request('Target.getTargets'),
        error: String(error),
      })
    } finally {
      baselineCdp.close()
      if (baseline.exitCode === null) baseline.kill('SIGTERM')
      await baseline.exited
      emit({
        stage: 'plain-headless-cleanup',
        family,
        pid: baseline.pid,
        alive: alive(baseline.pid),
      })
    }
    let owner: ChromiumWindow | undefined
    let pid = 0
    let failureStage = 'launch'
    try {
      owner = await launchChromium({
        candidate,
        stateHome: path.join(scratch, family),
        home: scratch,
        url,
        startup: { idleMs: 3000, limitMs: 10000 },
        native,
        observe: (value) => {
          pid = value
          return observe(value)
        },
        onOpen: (event) => emit({ stage: 'chromium-frames', family, ...event }),
        onFailure: (error) => {
          emit({ stage: 'chromium-failure', family, ...launcherFailureFacts(error) })
        },
      })
      failureStage = 'owned-window'
      assert.equal(owner.kind, 'owned')
      if (owner.kind !== 'owned') continue
      const cdp = owner.cdp
      emit({ stage: 'chromium-targets', family, targets: await cdp.request('Target.getTargets') })
      failureStage = 'page-target'
      let targetId = ''
      await until(async () => {
        const targets = await cdp.request('Target.getTargets')
        const target = (
          targets.targetInfos as { targetId: string; type: string; url: string }[]
        ).find((entry) => entry.type === 'page')
        targetId = target?.targetId ?? ''
        return Boolean(targetId)
      })
      const session = await cdp.request('Target.attachToTarget', { targetId, flatten: true })
      failureStage = 'document-bridge'
      let bridge: unknown
      await until(async () => {
        const evaluated = await cdp.request(
          'Runtime.evaluate',
          {
            expression:
              'globalThis.platformBridge && JSON.stringify({platform:platformBridge.platform,titlebar:platformBridge.titlebar,backdrop:platformBridge.backdrop,capture:platformBridge.capabilities.displayCapture,picker:typeof platformBridge.pickEntry})',
            returnByValue: true,
          },
          session.sessionId as string,
        )
        bridge = (evaluated.result as { value?: string }).value
        return typeof bridge === 'string'
      })
      assert.deepEqual(JSON.parse(bridge as string), {
        platform: 'darwin',
        titlebar: 'native',
        backdrop: 'app',
        capture: true,
        picker: 'function',
      })
      emit({ stage: 'chromium-bridge', family, pid, bridge: JSON.parse(bridge as string) })
      failureStage = 'last-page-cleanup'
      await cdp.request('Target.closeTarget', { targetId })
      await until(async () => !alive(pid))
      await owner.exited
      assert.equal((await fetch(url)).status, 200)
      emit({ stage: 'last-page-cleanup', family, pid, alive: alive(pid), sharedFixtureAlive: true })
    } catch (error) {
      failures.push(error)
      emit({
        stage: 'chromium-unconfirmed',
        family,
        failureStage,
        launchOwned: owner?.kind === 'owned',
        probeError: error instanceof Error ? error.message : String(error),
        ...(failureStage === 'launch' ? launcherFailureFacts(error) : {}),
      })
    } finally {
      await owner?.close()
    }
  }

  let nativePid = 0
  const hostSpawn = (args: readonly string[]) => {
    const child = spawn(args[0]!, args.slice(1), {
      stdio: 'pipe',
      env: { ...process.env, HOME: path.join(scratch, 'home') },
    })
    nativePid = child.pid!
    pids.add(nativePid)
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      exited: new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
        child.once('error', reject)
        child.once('close', (code, signal) => resolve({ code, signal }))
      }),
      kill: (signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM') => {
        child.kill(signal)
      },
    }
  }
  for (const vibrancy of [false, true]) {
    let bridge: Record<string, unknown> | undefined
    const host = await launchWebview({
      binary,
      url,
      platform: 'darwin',
      vibrancy,
      budget: native.budget,
      startup: { idleMs: 3000, limitMs: 10000 },
      spawn: hostSpawn,
      initialScript: `addEventListener('load',()=>webkit.messageHandlers.platformShell.postMessage({probe:{platform:platformBridge.platform,titlebar:platformBridge.titlebar,backdrop:platformBridge.backdrop,capture:platformBridge.capabilities.displayCapture,picker:typeof platformBridge.pickEntry}}));`,
      onMessage: (body) => {
        if (typeof body === 'object' && body && 'probe' in body)
          bridge = body.probe as Record<string, unknown>
      },
      onOpen: (event) => emit({ stage: 'webview-frames', ...event }),
    })
    try {
      await until(async () => !!bridge)
      assert.deepEqual(bridge, {
        platform: 'darwin',
        titlebar: 'overlay',
        backdrop: vibrancy ? 'transparent' : 'app',
        capture: false,
        picker: 'function',
      })
      emit({ stage: 'webview-bridge', pid: nativePid, vibrancy, bridge })
      // Picker cancellation exercises the sheet acknowledgement without choosing owner files.
      await assert.rejects(
        host.host.pick({ mode: 'folder', startingPath: scratch }),
        (error: unknown) => (error as { code: string }).code === 'desktop.webview.PICKER_TIMEOUT',
      )
      emit({ stage: 'webview-picker-timeout', pid: nativePid, vibrancy })
    } finally {
      await host.close()
    }
    assert.ok(!alive(nativePid))
    assert.equal((await fetch(url)).status, 200)
    emit({
      stage: 'webview-cleanup',
      pid: nativePid,
      vibrancy,
      alive: alive(nativePid),
      sharedFixtureAlive: true,
    })
  }
  const messageFile = path.join(scratch, 'failure.txt')
  await Bun.write(messageFile, 'Gate3 fixture failure\n\nFixture reason\n\nClose the fixture')
  await assert.rejects(
    runNativeDialog({
      binary,
      args: ['message', messageFile],
      budget: { dialogMs: 500, stopGraceMs: 500 },
      spawn: hostSpawn,
    }),
  )
  assert.ok(!alive(nativePid))
  emit({ stage: 'message-helper-cleanup', pid: nativePid, alive: alive(nativePid) })
  assert.equal(failures.length, 0, 'Chromium proof failed')
} finally {
  server.stop(true)
  emit({
    stage: 'cleanup',
    processes: [...pids].map((pid) => ({ pid, alive: alive(pid) })),
    fixtureClosed: true,
  })
}
