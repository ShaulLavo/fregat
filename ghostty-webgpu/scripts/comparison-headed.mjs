import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
} from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { promisify } from 'node:util'
import { chromium } from 'playwright'
import {
  assertBrowserAcceptanceRequest,
  observeOwnedBrowserProvenance,
} from './comparison-provenance.mjs'
import {
  boundedSmokeOperation,
  presentationSmokeHtml,
  proveHeadedPresentation,
} from './comparison-presentation.mjs'

const execute = promisify(execFile)
export const headedHardwareArguments = Object.freeze([
  '--ozone-platform=wayland',
  '--use-angle=vulkan',
  '--enable-features=Vulkan',
  '--ignore-gpu-blocklist',
  '--force-device-scale-factor=1',
  '--max-active-webgl-contexts=32',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=480,560',
])

export function headedLaunchArguments(profile) {
  assert(
    typeof profile === 'string' && profile.startsWith('/') && !/\s/.test(profile),
    'Canonical whitespace-free profile required',
  )
  // A following flag keeps a rewritten profile token distinct from positional startup URLs.
  return [`--user-data-dir=${profile}`, ...headedHardwareArguments, '--remote-debugging-port=0']
}

export function assertHeadedHardware({
  provenance,
  executable,
  profile,
  requestedArguments,
  gpu,
  window,
  gl,
}) {
  assert.equal(provenance.environment.launchMode, 'headed', 'Observed headed mode required')
  assert.equal(provenance.environment.headless, false, 'Actual headless state must be false')
  assert.equal(provenance.observedExecutable, executable, 'Actual executable custody mismatch')
  assert.equal(provenance.observedProfile, profile, 'Actual profile custody mismatch')
  assert.equal(
    provenance.originalExecveArguments,
    null,
    'Original execve boundaries remain unobserved',
  )
  const flags = provenance.observedFlagTokens
  assert(Array.isArray(flags), 'Actual observed flags required')
  assert(
    typeof provenance.observedFlagTokensQualification === 'string' &&
      provenance.observedFlagTokensQualification.length > 0,
    'Actual flag qualification required',
  )
  assert(
    typeof provenance.rawCommandLineBase64 === 'string' &&
      provenance.rawCommandLineBase64.length > 0,
    'Actual raw command line required',
  )
  assert(
    requestedArguments.every((argument) => !/\s/.test(argument) && flags.includes(argument)),
    'Whitespace-free requested arguments must be observed',
  )
  for (const [key, value] of Object.entries({
    '--ozone-platform': 'wayland',
    '--use-angle': 'vulkan',
    '--force-device-scale-factor': '1',
  }))
    assert.deepEqual(
      flags.filter((flag) => flag === key || flag.startsWith(key + '=')),
      [`${key}=${value}`],
      'Conflicting or unknown actual backend switches',
    )
  assert(
    !flags.some((flag) =>
      /(?:swiftshader|headless|--disable-gpu(?:=|$)|--disable-gpu-compositing|--use-gl(?:=|$)|--enable-automation|--ozone-platform-hint)/i.test(
        flag,
      ),
    ),
    'Unsupported actual browser switches',
  )
  assert.equal(window.browserPid, provenance.browserPid, 'Wrong compositor window owner')
  assert.equal(window.backend, 'wayland', 'Actual Wayland compositor window required')
  assert.equal(window.mapped, true, 'Mapped compositor window required')
  assert.equal(window.hidden, false, 'Visible compositor window required')
  assert.equal(window.xwayland, false, 'XWayland cannot qualify the fixed Wayland backend')
  assert.equal(gpu.auxAttributes.displayType, 'ANGLE_VULKAN', 'Actual Vulkan display required')
  assert.equal(
    gpu.auxAttributes.glImplementationParts,
    '(gl=egl-angle,angle=vulkan)',
    'Actual ANGLE Vulkan required',
  )
  assert.equal(gpu.auxAttributes.hardwareSupportsVulkan, true, 'Hardware Vulkan required')
  assert.equal(gpu.auxAttributes.inProcessGpu, false, 'Owned hardware GPU process required')
  assert.equal(gpu.featureStatus.gpu_compositing, 'enabled', 'Hardware compositing required')
  assert.equal(gpu.featureStatus.webgl, 'enabled', 'Hardware WebGL required')
  assert(
    ['enabled', 'enabled_on'].includes(gpu.featureStatus.vulkan),
    'Vulkan feature must be enabled',
  )
  assert(Array.isArray(gpu.devices) && gpu.devices.length > 0, 'Observed GPU devices required')
  assert(
    gpu.devices.every(
      (device) =>
        Number.isInteger(device.vendorId) &&
        device.vendorId > 0 &&
        Number.isInteger(device.deviceId) &&
        device.deviceId > 0,
    ),
    'Physical GPU device identities required',
  )
  const renderer = gpu.auxAttributes.glRenderer
  assert(
    typeof renderer === 'string' &&
      renderer.includes('Vulkan') &&
      !/swiftshader|llvmpipe|softpipe|lavapipe|software/i.test(renderer),
    'Observed hardware renderer required',
  )
  const activeDevice = gpu.devices.find((device) => device.deviceString === renderer)
  assert(activeDevice, 'Browser renderer must identify an observed physical GPU')
  const browserRenderer = renderer.match(/^ANGLE \((.+), ([^,()]+)\)$/)
  const pageRenderer =
    typeof gl.renderer === 'string' && gl.renderer.match(/^ANGLE \((.+), ([^,()]+)\)$/)
  assert(browserRenderer && pageRenderer, 'Structured actual ANGLE renderer labels required')
  assert.equal(
    pageRenderer[1],
    browserRenderer[1],
    'Page Vulkan and physical-device identity must match browser hardware',
  )
  // Page debug info may redact the driver version; CDP retains the independent vendor/version fields.
  assert(
    pageRenderer[2] === browserRenderer[2] ||
      (pageRenderer[2] === activeDevice.driverVendor &&
        browserRenderer[2] === `${activeDevice.driverVendor}-${activeDevice.driverVersion}`),
    'Page driver label must match the independently observed driver',
  )
  assert.equal(gl.contextLost, false, 'Live page WebGL context required')
}

async function identity(pid, read = readFile) {
  const raw = await read(`/proc/${pid}/stat`, 'utf8')
  const fields = raw
    .slice(raw.lastIndexOf(')') + 1)
    .trim()
    .split(/\s+/)
  return {
    pid,
    parentPid: Number(fields[1]),
    processGroup: Number(fields[2]),
    startTimeTicks: fields[19],
    state: fields[0],
  }
}

export async function ownedProcessAlive(owned, read = readFile) {
  try {
    const current = await identity(owned.pid, read)
    return current.startTimeTicks === owned.startTimeTicks && current.state !== 'Z'
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return false
    throw error
  }
}

async function ownedGroupProcesses(browserIdentity) {
  const result = []
  assert(
    await ownedProcessAlive(browserIdentity),
    'Browser lifetime must remain owned during group discovery',
  )
  for (const name of await readdir('/proc')) {
    if (!/^\d+$/.test(name)) continue
    try {
      const entry = await identity(Number(name))
      if (entry.processGroup === browserIdentity.pid) result.push(entry)
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error
    }
  }
  assert(
    await ownedProcessAlive(browserIdentity),
    'Browser lifetime changed during group discovery',
  )
  return result
}

async function processCustody(session, browserPid) {
  const { processInfo } = await session.send('SystemInfo.getProcessInfo')
  const result = []
  for (const entry of processInfo) {
    const observed = await identity(entry.id)
    let ancestor = observed
    const visited = new Set()
    while (ancestor.pid !== browserPid && ancestor.parentPid > 1 && !visited.has(ancestor.pid)) {
      visited.add(ancestor.pid)
      ancestor = await identity(ancestor.parentPid)
    }
    assert.equal(ancestor.pid, browserPid, 'CDP process must descend from owned browser')
    const raw = await readFile(`/proc/${entry.id}/cmdline`)
    const executable = await readlink(`/proc/${entry.id}/exe`)
    assert.equal(
      (await identity(entry.id)).startTimeTicks,
      observed.startTimeTicks,
      'Owned process lifetime changed',
    )
    result.push({
      ...observed,
      type: entry.type,
      executable,
      rawCommandLineBase64: raw.toString('base64'),
    })
  }
  assert.equal(
    result.filter((entry) => entry.type.toLowerCase() === 'gpu').length,
    1,
    'One owned GPU process required',
  )
  return result
}

/** An optional Hyprland adapter; other compositors supply observeWindow to the launch helper. */
export async function observeHyprlandWindow({ browserPid, smokeId }) {
  const { stdout } = await execute('hyprctl', ['clients', '-j'], {
    timeout: 2000,
    maxBuffer: 1_000_000,
  })
  const candidates = JSON.parse(stdout).filter(
    (client) => client.pid === browserPid && client.title.includes(smokeId),
  )
  assert.equal(candidates.length, 1, 'Exactly one owned nonce-bearing compositor window required')
  const client = candidates[0]
  return {
    backend: 'wayland',
    browserPid,
    mapped: client.mapped,
    hidden: client.hidden,
    xwayland: client.xwayland,
    client,
  }
}

async function devtoolsEndpoint(profile, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    assert(
      child.exitCode === null && child.signalCode === null,
      'Owned Chrome exited during startup',
    )
    try {
      const [port] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8'))
        .trim()
        .split('\n')
      assert(
        /^\d+$/.test(port) && Number(port) > 0 && Number(port) < 65536,
        'Owned Chrome CDP port required',
      )
      return `http://127.0.0.1:${port}`
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    await pause(50)
  }
  assert.fail('Owned Chrome CDP startup timed out')
}

export async function launchOwnedHeadedBrowser({ executablePath, taskRoot, observeWindow }) {
  assert.equal(process.platform, 'linux', 'This fixed Wayland/Vulkan launch recipe requires Linux')
  assert(typeof observeWindow === 'function', 'Actual compositor backend observer required')
  assert(
    !/\s/.test(taskRoot) && !/\s/.test(executablePath),
    'No argument spaces: rewritten OS command lines cannot recover execve boundaries',
  )
  const executable = await realpath(executablePath)
  const root = await realpath(taskRoot)
  assert.equal(root, taskRoot, 'Task root must be canonical')
  const rootStat = await lstat(root)
  assert(rootStat.isDirectory() && rootStat.uid === process.getuid(), 'Task root custody required')
  const executableStat = await lstat(executable)
  assert(executableStat.isFile(), 'Full Chrome executable file required')
  const binary = await open(executable, 'r')
  try {
    const header = Buffer.alloc(4)
    await binary.read(header, 0, 4, 0)
    assert.equal(header.toString('hex'), '7f454c46', 'Direct full Chrome ELF binary required')
  } finally {
    await binary.close()
  }
  const { stdout } = await execute(executable, ['--version'], { timeout: 2000 })
  const version = stdout.match(/(?:Chromium|Google Chrome)\s+(\d+\.\d+\.\d+\.\d+)/)
  assert(version, 'Full Chrome build identity required')
  const expectedProduct = `Chrome/${version[1]}`
  await mkdir(join(root, 'tmp'), { recursive: true })
  assert.equal(
    await realpath(join(root, 'tmp')),
    join(root, 'tmp'),
    'Profile parent must be canonical',
  )
  const profile = await mkdtemp(join(root, 'tmp', 'chrome-'))
  await chmod(profile, 0o700)
  const profileStat = await lstat(profile)
  assert.equal(profileStat.uid, process.getuid(), 'Profile UID custody required')
  assert.equal(profileStat.mode & 0o777, 0o700, 'Private owned profile required')
  assert.equal(await realpath(profile), profile, 'Profile must be canonical')
  const requestedArguments = headedLaunchArguments(profile)
  assertBrowserAcceptanceRequest({ acceptance: true, requestedHeadless: false, requestedArguments })
  const evidence = {
    smokeId: randomUUID(),
    requestedExecutable: executablePath,
    executable,
    expectedProduct,
    requestedArguments,
    requestedArgv: [executable, ...requestedArguments, 'about:blank'],
    originalExecveArguments: null,
    argumentSpaces: false,
    profile,
    cleanup: {},
    stderr: '',
  }
  let browser
  let child
  let server
  let owned = []
  let closed = false
  const close = async () => {
    if (closed) return evidence.cleanup
    closed = true
    const rootIdentity = owned.find((entry) => entry.pid === child?.pid)
    if (rootIdentity && (await ownedProcessAlive(rootIdentity))) {
      const group = await ownedGroupProcesses(rootIdentity)
      owned = [
        ...owned,
        ...group.filter((entry) => !owned.some((known) => known.pid === entry.pid)),
      ]
    }
    if (browser) {
      try {
        await boundedSmokeOperation(() => browser.close(), 3000)
      } catch (error) {
        evidence.cleanup.closeError = String(error)
      }
    }
    if (child?.pid && !owned.some((entry) => entry.pid === child.pid)) {
      try {
        owned.push(await identity(child.pid))
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      for (const entry of owned) {
        if (!(await ownedProcessAlive(entry))) continue
        try {
          process.kill(entry.pid, signal)
        } catch (error) {
          if (error.code !== 'ESRCH') throw error
        }
      }
      for (let attempt = 0; attempt < 20; attempt++) {
        if (!(await Promise.all(owned.map(ownedProcessAlive))).some(Boolean)) break
        await pause(50)
      }
    }
    evidence.cleanup.processes = await Promise.all(
      owned.map(async (entry) => ({ ...entry, alive: await ownedProcessAlive(entry) })),
    )
    assert(
      evidence.cleanup.processes.every((entry) => !entry.alive),
      'Owned Chrome processes survived cleanup',
    )
    evidence.cleanup.browserExited = !child || child.exitCode !== null || child.signalCode !== null
    assert(evidence.cleanup.browserExited, 'Owned browser exit must be observed')
    if (server) {
      server.closeAllConnections()
      await boundedSmokeOperation(
        () =>
          new Promise((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
        2000,
      )
    }
    evidence.cleanup.serverClosed = true
    await rm(profile, { recursive: true })
    evidence.cleanup.profileRemoved = true
    return evidence.cleanup
  }
  try {
    server = createServer((request, response) => {
      if (request.url !== `/?smoke=${evidence.smokeId}`) {
        response.writeHead(404).end()
        return
      }
      response
        .writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
        .end(presentationSmokeHtml(evidence.smokeId))
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    child = spawn(executable, [...requestedArguments, 'about:blank'], {
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    child.on('error', (error) => {
      evidence.spawnError = String(error)
    })
    child.stderr.on('data', (data) => {
      if (evidence.stderr.length < 64_000) evidence.stderr += data.toString()
    })
    owned.push(await identity(child.pid))
    const endpoint = await devtoolsEndpoint(profile, child)
    browser = await chromium.connectOverCDP(endpoint, { timeout: 5000 })
    const session = await boundedSmokeOperation(() => browser.newBrowserCDPSession(), 2000)
    const boundedSession = {
      send: (method, parameters) =>
        boundedSmokeOperation(() => session.send(method, parameters), 2000),
    }
    const provenance = await observeOwnedBrowserProvenance({
      session: boundedSession,
      taskRoot: root,
      requestedArguments,
      expectedProduct,
      requestedHeadless: false,
      acceptance: true,
      read: async (...parameters) => {
        const observed = await readFile(...parameters)
        if (parameters[0] === `/proc/${child.pid}/cmdline`)
          evidence.rawCommandLineBeforeAcceptanceBase64 = observed.toString('base64')
        return observed
      },
    })
    assert.equal(provenance.browserPid, child.pid, 'CDP browser must be exact spawned child')
    evidence.provenance = provenance
    const context = browser.contexts()[0]
    assert.equal(browser.contexts().length, 1, 'Single owned default context required')
    assert.equal(context.pages().length, 1, 'Single owned page required')
    const page = context.pages()[0]
    const url = `http://127.0.0.1:${server.address().port}/?smoke=${evidence.smokeId}`
    await page.goto(url, { timeout: 5000 })
    await boundedSmokeOperation(() => page.bringToFront(), 2000)
    const pageSession = await boundedSmokeOperation(() => context.newCDPSession(page), 2000)
    const target = (
      await boundedSmokeOperation(() => pageSession.send('Target.getTargetInfo'), 2000)
    ).targetInfo
    const window = await boundedSmokeOperation(
      () => pageSession.send('Browser.getWindowForTarget', { targetId: target.targetId }),
      2000,
    )
    const facts = await boundedSmokeOperation(
      () =>
        page.evaluate(() => {
          const gl = document
            .querySelector('canvas')
            .getContext('webgl2', { antialias: false, preserveDrawingBuffer: true })
          if (!gl) throw new Error('Hardware WebGL2 context unavailable')
          const extension = gl.getExtension('WEBGL_debug_renderer_info')
          return {
            width: innerWidth,
            height: innerHeight,
            dpr: devicePixelRatio,
            visibility: document.visibilityState,
            renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null,
            contextLost: gl.isContextLost(),
          }
        }),
      2000,
    )
    assert.equal(facts.dpr, 1, 'Actual unemulated DPR one required')
    assert.equal(facts.visibility, 'visible', 'Actual visible page required')
    const compositor = await boundedSmokeOperation(
      () =>
        observeWindow({
          browserPid: provenance.browserPid,
          smokeId: evidence.smokeId,
          windowId: window.windowId,
        }),
      2500,
    )
    const systemInfo = await boundedSession.send('SystemInfo.getInfo')
    evidence.hardware = { gpu: systemInfo.gpu, page: facts, compositor, window }
    assertHeadedHardware({
      provenance,
      executable,
      profile,
      requestedArguments,
      gpu: systemInfo.gpu,
      window: compositor,
      gl: facts,
    })
    owned = await processCustody(boundedSession, child.pid)
    evidence.ownedProcesses = owned
    const ownership = {
      targetId: target.targetId,
      windowId: window.windowId,
      url,
      viewport: { width: facts.width, height: facts.height },
    }
    return { page, session: pageSession, evidence, ownership, close }
  } catch (error) {
    error.launchEvidence = evidence
    try {
      await close()
    } catch (cleanupError) {
      evidence.cleanup.error = String(cleanupError)
    }
    throw error
  }
}

export async function runHeadedPresentationSmoke(options) {
  const owned = await launchOwnedHeadedBrowser(options)
  let failure
  try {
    owned.evidence.presentation = await proveHeadedPresentation({
      page: owned.page,
      session: owned.session,
      ownership: owned.ownership,
      smokeId: owned.evidence.smokeId,
    })
    owned.evidence.status = 'PASS_SETUP_ONLY'
  } catch (error) {
    owned.evidence.presentation = error.smokeEvidence
    failure = error
  } finally {
    try {
      await owned.close()
    } catch (error) {
      owned.evidence.cleanup.error = String(error)
      failure ??= error
    }
  }
  if (failure) {
    owned.evidence.status = 'UNKNOWN_FAILED_SETUP'
    failure.launchEvidence = owned.evidence
    throw failure
  }
  return owned.evidence
}
