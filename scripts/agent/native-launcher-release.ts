import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'
import type { Evidence } from './evidence'
import { nativeHostSelectors } from './selectors'
import { startupBudget } from '../../apps/desktop/src/launcher/startup'

export async function proveNativeLauncherRelease(
  page: Page,
  fixture: string,
  binary: string,
  serverUrl: string,
  signal: 'SIGTERM' | 'SIGKILL',
  evidence: Evidence,
) {
  const readyFile = path.join(fixture, `native-launcher-${signal}.json`)
  const root = path.resolve(import.meta.dirname, '../..')
  const prefix = `native-launcher-${signal}-`
  const source = `
    import { launchWebview } from ${JSON.stringify(root + '/apps/desktop/src/launcher/native-window.ts')};
    import { nativeBudget } from ${JSON.stringify(root + '/apps/desktop/src/launcher/native-helper.ts')};
    import { startupBudget } from ${JSON.stringify(root + '/apps/desktop/src/launcher/startup.ts')};
    const controller = new AbortController();
    process.once('SIGTERM', () => controller.abort());
    let ready = false;
    const window = await launchWebview({
      binary: ${JSON.stringify(binary)}, url: ${JSON.stringify(page.url())},
      stateHome: ${JSON.stringify(path.join(fixture, 'native-launcher-state'))},
      signal: controller.signal, budget: nativeBudget(), startup: startupBudget(),
      initialScript: ${JSON.stringify(`window.platformDevServerUrl=${JSON.stringify(serverUrl)};sessionStorage.setItem('fregat.terminal-namespace',${JSON.stringify(prefix)});`)},
      onOpen: () => {}, onMessage: body => { if (body?.nativeProof?.ready) ready = true; }
    });
    try {
      const deadline = Date.now() + startupBudget().limitMs;
      while (!ready && Date.now() < deadline) {
        window.host.evaluate(${JSON.stringify(`webkit.messageHandlers.platformShell.postMessage({nativeProof:(${nativeHostSelectors.readiness})})`)});
        await Bun.sleep(100);
      }
      if (!ready) process.exitCode = 2;
      else {
        const children = await Bun.file('/proc/' + process.pid + '/task/' + process.pid + '/children').text();
        await Bun.write(${JSON.stringify(readyFile)}, JSON.stringify({ pids: children.trim().split(/\\s+/).map(Number), ready }));
        await window.exited.catch(() => {});
      }
    } finally { await window.close(); }
  `
  const launcher = Bun.spawn([process.execPath, '-e', source], {
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  const diagnostics = new Response(launcher.stderr).text()
  let child: { pid: number; startTime: string } | undefined
  try {
    const deadline = Date.now() + startupBudget().limitMs
    while (!existsSync(readyFile) && Date.now() < deadline && launcher.exitCode === null)
      await Bun.sleep(50)
    ok(existsSync(readyFile), 'The owned native launcher renders the actual fixture app')
    const { pids, ready } = JSON.parse(readFileSync(readyFile, 'utf8'))
    ok(ready && pids.length === 1 && Number.isSafeInteger(pids[0]), 'The launcher owns one host')
    const before = observe(pids[0])
    ok(before && before.state !== 'Z', 'The native host is live before launcher termination')
    child = { pid: pids[0], startTime: before.startTime }
    launcher.kill(signal)
    await launcher.exited
    const end = Date.now() + startupBudget().limitMs
    while (observe(child.pid)?.startTime === child.startTime && Date.now() < end)
      await Bun.sleep(50)
    const after = observe(child.pid)
    await evidence.json(`native-launcher-${signal}.json`, {
      signal,
      child,
      before,
      after,
      parentExit: launcher.exitCode,
    })
    ok(!after || after.startTime !== child.startTime, 'The owned native host is reaped')
  } finally {
    if (launcher.exitCode === null) launcher.kill('SIGTERM')
    await launcher.exited
    if (child && observe(child.pid)?.startTime === child.startTime) {
      process.kill(child.pid, 'SIGTERM')
    }
    await evidence.json(`native-launcher-${signal}-cleanup.json`, {
      parentExit: launcher.exitCode,
      child: child ? observe(child.pid) : null,
      stderrBytes: Buffer.byteLength(await diagnostics),
    })
  }
}

function observe(pid: number) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const fields = stat.slice(stat.lastIndexOf(') ') + 2).split(' ')
    return { state: fields[0], startTime: fields[19]! }
  } catch {
    return null
  }
}
