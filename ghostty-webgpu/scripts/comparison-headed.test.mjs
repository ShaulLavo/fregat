import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import {
  assertHeadedHardware,
  headedLaunchArguments,
  ownedProcessAlive,
  ownedProcessStates,
  settleOwnedWindowGeometry,
} from './comparison-headed.mjs'
import { observeOwnedBrowserProvenance } from './comparison-provenance.mjs'

function observedFacts() {
  const executable = '/fixture/chrome'
  const profile = '/fixture/task/tmp/chrome-123'
  const requestedArguments = headedLaunchArguments(profile)
  const renderer =
    'ANGLE (NVIDIA, Vulkan 1.4.341 (NVIDIA NVIDIA GeForce RTX 3060 Ti (0x00002489)), NVIDIA-610.57.4.0)'
  return {
    executable,
    profile,
    requestedArguments,
    provenance: {
      environment: { launchMode: 'headed', headless: false },
      browserPid: 123,
      observedExecutable: executable,
      observedProfile: profile,
      originalExecveArguments: null,
      observedFlagTokens: requestedArguments,
      observedFlagTokensQualification:
        'Exact whitespace tokens in observed OS rendering; original argv boundaries are unavailable',
      rawCommandLineBase64: Buffer.from(requestedArguments.join(' ') + '\0').toString('base64'),
    },
    window: { browserPid: 123, backend: 'wayland', mapped: true, hidden: false, xwayland: false },
    gpu: {
      devices: [
        {
          vendorId: 4318,
          deviceId: 9353,
          deviceString: renderer,
          vendorString: 'Google Inc. (NVIDIA)',
          driverVendor: 'NVIDIA',
          driverVersion: '610.57.4.0',
        },
      ],
      auxAttributes: {
        displayType: 'ANGLE_VULKAN',
        glImplementationParts: '(gl=egl-angle,angle=vulkan)',
        hardwareSupportsVulkan: true,
        inProcessGpu: false,
        glRenderer: renderer,
      },
      featureStatus: { gpu_compositing: 'enabled', webgl: 'enabled', vulkan: 'enabled_on' },
    },
    gl: { renderer, contextLost: false },
  }
}

test('actual raw tokens without original execve boundaries qualify only with independent custody, hardware and compositor facts', () => {
  assertHeadedHardware(observedFacts())
})

test('headless, unknown and contradictory actual modes fail before acquisition', () => {
  for (const mode of ['headless', 'unknown', 'contradictory']) {
    const facts = observedFacts()
    facts.provenance.environment.launchMode = mode
    assert.throws(() => assertHeadedHardware(facts), /Observed headed/)
  }
  const facts = observedFacts()
  facts.provenance.environment.headless = null
  assert.throws(() => assertHeadedHardware(facts), /headless state/)
})

test('requested-only flags, ambiguous argument spaces, missing raw evidence and changed executable or profile fail', () => {
  for (const change of [
    (facts) => {
      facts.provenance.observedFlagTokens = []
    },
    (facts) => {
      facts.requestedArguments = ['--user-data-dir=/some path']
    },
    (facts) => {
      facts.provenance.rawCommandLineBase64 = null
    },
    (facts) => {
      facts.provenance.observedFlagTokensQualification = ''
    },
    (facts) => {
      facts.provenance.observedExecutable = '/another/chrome'
    },
    (facts) => {
      facts.provenance.observedProfile = '/another/profile'
    },
  ]) {
    const facts = observedFacts()
    change(facts)
    assert.throws(() => assertHeadedHardware(facts))
  }
})

test('conflicting observed backend switches and software or automation switches reject', () => {
  for (const flag of [
    '--ozone-platform=x11',
    '--ozone-platform=wayland',
    '--ozone-platform=headless',
    '--use-angle=swiftshader',
    '--use-angle=gl',
    '--disable-gpu',
    '--disable-gpu-compositing',
    '--use-gl=angle',
    '--enable-automation',
    '--ozone-platform-hint=auto',
    '--force-device-scale-factor=2',
  ]) {
    const facts = observedFacts()
    facts.provenance.observedFlagTokens = [...facts.provenance.observedFlagTokens, flag]
    assert.throws(() => assertHeadedHardware(facts), undefined, flag)
  }
})

test('actual non-Wayland, foreign, hidden, unmapped and XWayland compositor windows reject', () => {
  for (const patch of [
    { backend: 'x11' },
    { browserPid: 456 },
    { mapped: false },
    { hidden: true },
    { xwayland: true },
  ]) {
    const facts = observedFacts()
    Object.assign(facts.window, patch)
    assert.throws(() => assertHeadedHardware(facts))
  }
})

test('actual software, unknown, inconsistent and unavailable GPU facts reject', () => {
  for (const change of [
    (facts) => {
      facts.gpu.auxAttributes.glRenderer = 'ANGLE Vulkan SwiftShader'
    },
    (facts) => {
      facts.gpu.auxAttributes.glRenderer = ''
    },
    (facts) => {
      facts.gpu.auxAttributes.displayType = 'ANGLE_OPENGL'
    },
    (facts) => {
      facts.gpu.auxAttributes.glImplementationParts = '(gl=egl-angle,angle=opengl)'
    },
    (facts) => {
      facts.gpu.auxAttributes.hardwareSupportsVulkan = false
    },
    (facts) => {
      facts.gpu.auxAttributes.inProcessGpu = true
    },
    (facts) => {
      facts.gpu.featureStatus.gpu_compositing = 'disabled_software'
    },
    (facts) => {
      facts.gpu.featureStatus.webgl = 'unavailable'
    },
    (facts) => {
      facts.gpu.featureStatus.vulkan = 'disabled_off'
    },
    (facts) => {
      facts.gpu.devices = []
    },
    (facts) => {
      facts.gpu.devices[0].vendorId = 0
    },
    (facts) => {
      facts.gl.renderer = 'Another GPU'
    },
    (facts) => {
      facts.gl.contextLost = true
    },
  ]) {
    const facts = observedFacts()
    change(facts)
    assert.throws(() => assertHeadedHardware(facts))
  }
})

test('standalone recipe skips with stated reason when the display is absent, without launching Chrome', async () => {
  const root = await mkdtemp(join(tmpdir(), 'headed-recipe-test-'))
  try {
    const output = join(root, 'proof')
    const script = join(import.meta.dirname, 'headed-presentation-smoke.mjs')
    await promisify(execFile)(
      process.execPath,
      [
        script,
        '--executable',
        '/missing/chrome',
        '--output',
        output,
        '--window-system',
        'hyprland',
      ],
      { env: { ...process.env, WAYLAND_DISPLAY: '', XDG_RUNTIME_DIR: '' }, timeout: 5000 },
    )
    const result = JSON.parse(await readFile(join(output, 'result.json'), 'utf8'))
    assert.equal(result.status, 'SKIP')
    assert.match(result.reason, /No Wayland display/)
    assert.equal(result.terminalMarkers, 0)
    assert.equal(result.measurements, 0)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('approved real provenance rejects profile-last startup URL and accepts the fixed profile-before-flag order', async () => {
  const profile = '/fixture/task/tmp/chrome-owned'
  const flags = headedLaunchArguments(profile)
  const product = 'Chrome/152.0.7977.82'
  const session = {
    async send(method) {
      if (method === 'Browser.getVersion')
        return { product, userAgent: 'Chrome/152.0.7977.82', revision: 'synthetic-version' }
      assert.equal(method, 'SystemInfo.getProcessInfo')
      return { processInfo: [{ id: 101, type: 'browser' }] }
    },
  }
  const observe = (arguments_) =>
    observeOwnedBrowserProvenance({
      session,
      taskRoot: '/fixture/task',
      ownerPid: 100,
      platform: 'linux',
      expectedProduct: product,
      requestedArguments: flags,
      requestedHeadless: false,
      acceptance: true,
      read: async (path) => {
        if (path.endsWith('/stat'))
          return `101 (chrome) S 100 ${Array(17).fill('0').join(' ')} 123456 0\n`
        assert.equal(path, '/proc/101/cmdline')
        return Buffer.from(['/fixture/chrome', ...arguments_, 'about:blank'].join(' ') + '\0')
      },
      readLink: async () => '/fixture/chrome',
    })
  await assert.rejects(
    observe([...flags.slice(1), flags[0]]),
    /Rendered profile boundary is ambiguous/,
  )
  const actual = await observe(flags)
  assert.equal(actual.observedProfile, profile)
  assert.equal(actual.environment.launchMode, 'headed')
  assert.equal(actual.originalExecveArguments, null)
  assert.deepEqual(actual.observedFlagTokens, flags)
})

test('the observed vendor-only page driver label matches CDP vendor/version, with exact Vulkan device identity', () => {
  const facts = observedFacts()
  const renderer =
    'ANGLE (NVIDIA, Vulkan 1.4.341 (NVIDIA NVIDIA GeForce RTX 3060 Ti (0x00002489)), NVIDIA-610.57.4.0)'
  facts.gpu.auxAttributes.glRenderer = renderer
  Object.assign(facts.gpu.devices[0], {
    deviceString: renderer,
    driverVendor: 'NVIDIA',
    driverVersion: '610.57.4.0',
  })
  facts.gl.renderer =
    'ANGLE (NVIDIA, Vulkan 1.4.341 (NVIDIA NVIDIA GeForce RTX 3060 Ti (0x00002489)), NVIDIA)'
  assertHeadedHardware(facts)
  const valid = facts.gl.renderer
  for (const invalid of [
    valid.replace('0x00002489', '0x00001234'),
    valid.replace('RTX 3060 Ti', 'Another GPU'),
    valid.replace('Vulkan 1.4.341', 'OpenGL 4.6'),
    valid.replace('Vulkan 1.4.341', 'Vulkan 1.3.341'),
    valid.replace('ANGLE (NVIDIA,', 'ANGLE (AMD,'),
    valid.replace('NVIDIA)', 'AMD)'),
    valid.replace('NVIDIA)', 'NVIDIA-unknown)'),
    'unknown',
  ]) {
    facts.gl.renderer = invalid
    assert.throws(() => assertHeadedHardware(facts))
  }
  facts.gl.renderer = valid
  facts.gpu.devices[0].driverVersion = 'unexpected'
  assert.throws(() => assertHeadedHardware(facts), /Page driver label/)
})

test('Linux process disappearance via ESRCH or ENOENT is gone; other OS errors remain unknown', async () => {
  const owned = { pid: 101, startTimeTicks: '123456' }
  for (const code of ['ENOENT', 'ESRCH']) {
    const gone = Object.assign(new Error('External proc disappearance'), { code })
    assert.equal(
      await ownedProcessAlive(owned, async () => {
        throw gone
      }),
      false,
    )
  }
  const denied = Object.assign(new Error('External proc read denied'), { code: 'EACCES' })
  await assert.rejects(
    ownedProcessAlive(owned, async () => {
      throw denied
    }),
    denied,
  )
  const read =
    (start, state = 'S') =>
    async () =>
      `101 (chrome) ${state} 100 ${Array(17).fill('0').join(' ')} ${start} 0\n`
  assert.equal(await ownedProcessAlive(owned, read('123456')), true)
  assert.equal(await ownedProcessAlive(owned, read('123457')), false)
  assert.equal(await ownedProcessAlive(owned, read('123456', 'Z')), false)
})

test('multi-process cleanup state batches preserve the OS reader, independent of Array.map indexes', async () => {
  const owned = [
    { pid: 101, startTimeTicks: '123456' },
    { pid: 102, startTimeTicks: '123457' },
  ]
  const read = async (path) => {
    const pid = Number(path.split('/')[2])
    return `${pid} (chrome) S 100 ${Array(17).fill('0').join(' ')} ${pid === 101 ? '123456' : 'changed-lifetime'} 0\n`
  }
  const states = await ownedProcessStates(owned, read)
  assert.deepEqual(
    states.map(({ pid, alive }) => ({ pid, alive })),
    [
      { pid: 101, alive: true },
      { pid: 102, alive: false },
    ],
  )
  const vanished = await ownedProcessStates(owned, async () => {
    throw Object.assign(new Error('External process gone'), { code: 'ESRCH' })
  })
  assert(vanished.every((entry) => !entry.alive))
})

test('setup waits for actual native resize agreement twice before capturing ownership viewport', async () => {
  let count = 0
  const page = {
    evaluate: async () =>
      ++count === 1
        ? {
            width: 500,
            height: 431,
            outerWidth: 532,
            outerHeight: 560,
            dpr: 1,
            visibility: 'visible',
          }
        : {
            width: 922,
            height: 943,
            outerWidth: 922,
            outerHeight: 1030,
            dpr: 1,
            visibility: 'visible',
          },
  }
  const session = {
    send: async () => ({
      windowId: 7,
      bounds: {
        width: count === 1 ? 532 : 922,
        height: count === 1 ? 560 : 1030,
        windowState: 'normal',
      },
    }),
  }
  const observeWindow = async () => ({
    browserPid: 101,
    backend: 'wayland',
    mapped: true,
    hidden: false,
    xwayland: false,
    size: { width: 922, height: 1030 },
  })
  const ready = await settleOwnedWindowGeometry({
    page,
    session,
    observeWindow,
    browserPid: 101,
    windowId: 7,
    targetId: 'owned-page',
    smokeId: 'owned-smoke',
  })
  assert.equal(ready.snapshots.length, 3)
  assert.deepEqual(
    { width: ready.page.width, height: ready.page.height },
    { width: 922, height: 943 },
  )
  assert.equal(ready.snapshots[0].page.width, 500)
})

test('setup refuses contradictory page/CDP/compositor sizes without guessing a transform', async () => {
  const page = {
    evaluate: async () => ({
      width: 500,
      height: 431,
      outerWidth: 532,
      outerHeight: 560,
      dpr: 1,
      visibility: 'visible',
    }),
  }
  const session = {
    send: async () => ({ windowId: 7, bounds: { width: 532, height: 560, windowState: 'normal' } }),
  }
  const observeWindow = async () => ({
    browserPid: 101,
    backend: 'wayland',
    mapped: true,
    hidden: false,
    xwayland: false,
    size: { width: 922, height: 1030 },
  })
  await assert.rejects(
    settleOwnedWindowGeometry({
      page,
      session,
      observeWindow,
      browserPid: 101,
      windowId: 7,
      targetId: 'owned-page',
      smokeId: 'owned-smoke',
    }),
    /geometry did not settle/,
  )
})
