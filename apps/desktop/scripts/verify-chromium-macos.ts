import assert from 'node:assert/strict'
import path from 'node:path'
import { launchChromium, type ChromiumWindow } from '../src/launcher/chromium'
import { chromiumArguments } from '../src/launcher/profile'
import { startupBudget } from '../src/launcher/startup'
import { launcherFailureFacts } from '../src/launcher/failure'
import { macProcessAlive as alive } from './mac-process'
import type { BrowserCandidate } from '../src/launcher/browser'
import type { CdpClient } from '../src/launcher/cdp'

// The mock keychain belongs only to this explicit SSH scratch proof; desktop launch arguments stay unchanged.
assert.equal(process.platform, 'darwin')
const scratch = process.argv[2]!
assert.ok(path.isAbsolute(scratch) && /^\/Users\/shaul\/tmp\/fregat-g3b-[\w-]+$/.test(scratch))
assert.equal(process.env.HOME, path.join(scratch, 'home'))
const mockKeychain = process.argv.includes('--mock-keychain')
const pids = new Set<number>()
const requests: string[] = []
const emit = (event: Record<string, unknown>) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), ...event }))
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch: (request) => {
    requests.push(new URL(request.url).pathname)
    return new Response('<!doctype html><title>G3b runtime</title><h1>G3b runtime</h1>', {
      headers: { 'Content-Type': 'text/html' },
    })
  },
})
const url = `http://127.0.0.1:${server.port}/`
const until = async (check: () => Promise<boolean>) => {
  const end = Date.now() + 5000
  while (Date.now() < end) {
    if (await check()) return
    await Bun.sleep(50)
  }
  assert.fail('Scratch Chromium condition timed out')
}
const pages = async (cdp: CdpClient) => {
  const result = await cdp.request('Target.getTargets')
  return (result.targetInfos as { type: string; targetId: string; url: string }[]).filter(
    (target) => target.type === 'page',
  )
}
const checkDocuments = async (cdp: CdpClient, family: string) => {
  for (const target of await pages(cdp)) {
    const session = await cdp.request('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    })
    let document: Record<string, unknown> | undefined
    await until(async () => {
      const evaluated = await cdp.request(
        'Runtime.evaluate',
        {
          expression:
            'JSON.stringify({url:location.href,title:document.title,ready:document.readyState,platform:globalThis.platformBridge?.platform,titlebar:globalThis.platformBridge?.titlebar,backdrop:globalThis.platformBridge?.backdrop,capture:globalThis.platformBridge?.capabilities.displayCapture,picker:typeof globalThis.platformBridge?.pickEntry})',
          returnByValue: true,
        },
        session.sessionId as string,
      )
      document = JSON.parse((evaluated.result as { value: string }).value)
      return document?.title === 'G3b runtime' && document?.platform === 'darwin'
    })
    assert.deepEqual(document, {
      url,
      title: 'G3b runtime',
      ready: 'complete',
      platform: 'darwin',
      titlebar: 'native',
      backdrop: 'app',
      capture: true,
      picker: 'function',
    })
    emit({ stage: 'app-pipe-document-bridge', family, targetId: target.targetId, document })
  }
}

async function verifyBrowser(family: string, executable: string) {
  const candidate: BrowserCandidate = {
    kind: 'chromium',
    family,
    executable,
    args: [],
    confinement: 'none',
    source: 'setting',
  }
  assert.ok(!chromiumArguments(candidate, scratch, url).includes('--use-mock-keychain'))
  if (mockKeychain) candidate.args = ['--use-mock-keychain']
  const failures: unknown[] = []
  let owner: ChromiumWindow | undefined
  let second: ChromiumWindow | undefined
  let failureStage = 'launch'
  let pid = 0
  const options = {
    candidate,
    stateHome: path.join(scratch, `runtime-${family}`),
    home: path.join(scratch, 'home'),
    url,
    startup: startupBudget(),
    observe: (value: number) => {
      pid = value
      pids.add(value)
      return {}
    },
    onOpen: (event: Record<string, unknown>) =>
      emit({ stage: 'app-pipe-frames', family, ...event }),
    onFailure: (error: unknown) => {
      failures.push(error)
      emit({ stage: 'app-pipe-failure', family, ...launcherFailureFacts(error) })
    },
  }
  try {
    owner = await launchChromium(options)
    assert.ok(owner.kind === 'owned')
    const cdp = owner.cdp
    const processInfo = await cdp.request('SystemInfo.getProcessInfo')
    const browser = (processInfo.processInfo as { type: string; id: number }[]).find(
      (entry) => entry.type === 'browser',
    )
    assert.ok(browser && browser.id > 0)
    pid = browser.id
    pids.add(pid)
    emit({ stage: 'app-pipe-owned', family, pid, mockKeychain, transport: cdp.snapshot() })
    failureStage = 'first-document'
    await checkDocuments(cdp, family)
    failureStage = 'new-window'
    await cdp.request('Target.createTarget', { url, newWindow: true })
    await until(async () => (await pages(cdp)).length === 2)
    await checkDocuments(cdp, family)
    failureStage = 'singleton-handoff'
    second = await launchChromium({ ...options, onOpen: () => {} })
    assert.equal(second.kind, 'handoff')
    await until(async () => (await pages(cdp)).length === 3)
    await checkDocuments(cdp, family)
    emit({ stage: 'app-pipe-live-singleton', family, kind: second.kind, pages: 3 })
    failureStage = 'last-page-close'
    const targets = await pages(cdp)
    for (const target of targets)
      await cdp.request('Target.closeTarget', { targetId: target.targetId })
    await until(async () => [...pids].every((ownedPid) => !alive(ownedPid)))
    await owner.exited
    for (const ownedPid of pids) assert.ok(!alive(ownedPid))
    assert.equal((await fetch(url)).status, 200)
    assert.equal(failures.length, 0)
    emit({
      stage: 'app-pipe-last-page-cleanup',
      family,
      fixtureAlive: true,
      requests: [...requests],
    })
  } catch (error) {
    emit({ stage: 'app-pipe-unconfirmed', family, failureStage, message: String(error) })
    throw error
  } finally {
    if (second?.kind === 'owned') await second.close()
    await owner?.close()
  }
}

try {
  emit({ stage: 'fixture', scratch, url, mockKeychain, transport: 'production-cdp-pipe' })
  assert.equal((await fetch(url)).status, 200)
  for (const [family, executable] of [
    ['chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    ['helium', '/Applications/Helium.app/Contents/MacOS/Helium'],
  ]) {
    await verifyBrowser(family!, executable!)
  }
} finally {
  const fixturePort = server.port
  server.stop(true)
  emit({
    stage: 'fixture-cleanup',
    fixturePort,
    fixtureClosed: true,
    pids: [...pids].map((pid) => ({ pid, alive: alive(pid) })),
  })
}
