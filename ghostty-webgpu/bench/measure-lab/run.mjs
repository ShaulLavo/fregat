import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, writeFile, appendFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { recordingGl } from './recording-gl.mjs'
import { recordingCanvas } from './recording-canvas.mjs'

const argumentsMap = new Map()
for (let index = 2; index < process.argv.length; index += 2)
  argumentsMap.set(process.argv[index], process.argv[index + 1])
const get = (name, fallback) => argumentsMap.get(`--${name}`) ?? fallback
const root = resolve(get('artifacts', '.'))
const output = resolve(get('output', join(root, 'samples.jsonl')))
const arms = get('arms', 'A,B').split(',')
const workload = get('workload', 'line-scroll')
const phase = get('phase', 'full')
const publication = get('publication', 'text')
const backend = get('backend', 'webgl')
const sources = get('sources', arms.join(',')).split(',')
const extraArm = get('extra-loop-arm', '')
const extraIterations = Number(get('extra-loop-iterations', '0'))
const ticks = Number(get('ticks', '900'))
const count = Number(get('count', '1'))
const repetitions = Number(get('repetitions', '4'))
const reuseActors = get('reuse-actors', 'false') === 'true'
const warmTicks = Number(get('warm-ticks', '5000'))
assert.equal(process.platform, 'linux', 'perf_event prototype requires Linux')
assert.equal(process.arch, 'x64', 'fixed-three-instruction calibration requires x86_64')
assert.equal(sources.length, arms.length, 'one source per arm')
assert(
  arms.length >= 1 && arms.length <= 2 && new Set(arms).size === arms.length,
  'one or two distinct arm labels',
)
assert(['webgl', 'canvas'].includes(backend), 'supported command backend')
assert(['text', 'canvas', 'none'].includes(publication), 'supported publication shape')
assert(
  ['full', 'parse', 'frame', 'gl-commands', 'canvas-commands', 'publication'].includes(phase),
  'supported phase',
)
assert(
  phase !== (backend === 'canvas' ? 'gl-commands' : 'canvas-commands'),
  'command phase matches backend',
)
assert(['true', 'false'].includes(get('reuse-actors', 'false')), 'reuse-actors is true or false')
assert(!extraArm || arms.includes(extraArm), 'injected loop arm is present')
assert(
  [ticks, count, repetitions, warmTicks].every((value) => Number.isInteger(value) && value > 0),
  'positive integer work counts',
)
assert(
  Number.isInteger(extraIterations) && extraIterations >= 0 && extraIterations <= 0xffffffff,
  'bounded calibration loop',
)
const require = createRequire(import.meta.url)
const counter = require(join(root, 'counters.node'))
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'))
const { rollingFixture } = await import(pathToFileURL(join(root, 'fixtures.mjs')))
const logs = await readFile(join(root, 'logs.txt'), 'utf8')
const fixture = rollingFixture(logs, 1024 * 1024, 4096, workload)
const fixtureDigest = createHash('sha256').update(fixture.bytes).digest('hex')
const fields = ['instructions', 'cycles', 'enabledNs', 'runningNs']
const modules = new Map()
for (const [index, arm] of arms.entries()) {
  const source = sources[index]
  assert(manifest.arms[source], 'source arm present in manifest')
  const api = await import(pathToFileURL(join(root, source, 'runtime.mjs')))
  const wasm = await readFile(join(root, source, 'ghostty-webgpu/ghostty-vt.wasm'))
  const bridge = await readFile(join(root, source, 'ghostty-webgpu/bridge.wasm'))
  const runtime = await api.GhosttyRuntime.create({ wasm, bridge })
  modules.set(arm, { ...api, runtime })
}
function cpuList(value) {
  return value
    .trim()
    .split(',')
    .flatMap((part) => {
      const [first, last = first] = part.split('-').map(Number)
      return Array.from({ length: last - first + 1 }, (_, offset) => first + offset)
    })
}
const status = await readFile('/proc/self/status', 'utf8')
const allowed = cpuList(status.match(/^Cpus_allowed_list:\s*(.+)$/m)[1])
let defaultPmu = 0
let defaultCpu = allowed[0]
try {
  const pmuCpus = cpuList(await readFile('/sys/bus/event_source/devices/cpu_core/cpus', 'utf8'))
  defaultCpu = pmuCpus.find((cpu) => allowed.includes(cpu))
  assert(defaultCpu !== undefined, 'an allowed performance CPU is required on a hybrid host')
  defaultPmu = Number(await readFile('/sys/bus/event_source/devices/cpu_core/type', 'utf8'))
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const pmu = Number(get('pmu', String(defaultPmu)))
const cpu = Number(get('cpu', String(defaultCpu)))
assert(allowed.includes(cpu), 'requested CPU is in this job affinity')
counter.open(pmu, cpu)
await writeFile(output, '', { flag: 'wx' })
const head = {
  kind: 'configuration',
  node: process.version,
  v8: process.versions.v8,
  flags: process.execArgv,
  scope: 'main thread retired user instructions; no kernel/worker/GPU process',
  workload,
  phase,
  publication,
  backend,
  arms,
  sources,
  pmu,
  cpu,
  extraArm,
  extraIterations,
  harnessSha256: createHash('sha256')
    .update(await readFile(new URL(import.meta.url)))
    .digest('hex'),
  reuseActors,
  warmTicks,
  repetitions,
  count,
  ticks,
  fixtureDigest,
  fixtureBytes: fixture.bytes.length,
  manifest,
}
await appendFile(output, `${JSON.stringify(head)}\n`)

function checkedStop() {
  const value = counter.stop()
  assert(value.instructions > 0, 'hardware counter must advance')
  assert(value.runningNs / value.enabledNs > 0.999, 'multiplexed or unavailable PMU')
  return value
}

function makeActor(api) {
  const terminal = api.runtime.createTerminal({
    columns: 40,
    rows: 12,
    cellWidth: 16,
    cellHeight: 28,
  })
  terminal.setScrollbackLimit(200000)
  terminal.setScrollbackByteLimit(64 * 1024 * 1024)
  terminal.write('\x1b[?25l\x1b[?2027l')
  const state = api.runtime.createRenderState(terminal)
  const builder = state.createFrameBuilder(40, 12)
  const atlas = new api.GlyphAtlas({ pageWidth: 512, pageHeight: 512 })
  const rasterizer = {
    rasterize(input) {
      if (input.text === ' ') return undefined
      return {
        width: 8,
        height: 16,
        offsetX: 0,
        offsetY: 0,
        kind: 'grayscale',
        pixels: new Uint8Array(128).fill(255),
      }
    },
  }
  const options = {
    cellWidth: 16,
    cellHeight: 28,
    theme: {
      ...api.defaultRendererTheme,
      cursorText: api.defaultRendererTheme.cursorText ?? api.defaultRendererTheme.background,
    },
    full: true,
    overlayRows: new Set(),
  }
  const { gl, stats } = recordingGl()
  const pass = new api.WebGlTextPass({
    atlasLayout: atlas.textureLayout,
    context: gl,
    width: 640,
    height: 336,
    instanceCount: 480,
  })
  const canvas = recordingCanvas()
  const font = {
    charLeft: 0,
    charTop: 0,
    deviceCellWidth: 16,
    deviceCellHeight: 28,
    deviceCharWidth: 16,
    deviceCharHeight: 28,
    deviceBaseline: 22,
    cssCellWidth: 8,
    cssCellHeight: 14,
    pixelRatio: 2,
    settings: { family: 'monospace', size: 14, weight: 400, boldWeight: 700 },
  }
  const painter =
    backend === 'canvas'
      ? new api.CanvasRowPainter(canvas.context, font, {
          ...api.defaultRendererTheme,
          cursorText: api.defaultRendererTheme.cursorText ?? api.defaultRendererTheme.background,
        })
      : undefined
  painter?.resetContext(font)
  let delivered
  const observerOptions = { rows: 12 }
  if (publication !== 'none')
    observerOptions.onTextFrame = (frame) => {
      delivered = frame
    }
  const observer = new api.FrameObserver(observerOptions)
  return {
    api,
    terminal,
    state,
    builder,
    atlas,
    rasterizer,
    options,
    pass,
    stats,
    canvas,
    painter,
    observer,
    delivered: () => delivered,
    rebuilt: 0,
    bytes: 0,
    frameTicks: 0,
  }
}

function stage(actor, name, action, measured) {
  if (name !== phase || !measured) {
    action()
    return
  }
  counter.start()
  action()
  const sample = checkedStop()
  for (const field of fields) measured[field] += sample[field]
}

function tick(actor, index, measured, payload) {
  let updates
  let rows
  stage(
    actor,
    'parse',
    () => {
      const bytes = payload ?? fixture.chunks[index % fixture.chunks.length]
      actor.terminal.write(bytes)
      actor.bytes += bytes.length
    },
    measured,
  )
  stage(
    actor,
    'frame',
    () => {
      actor.state.update()
      actor.frameTicks += 1
      if (backend === 'canvas') {
        rows = actor.state.readRows({ dirtyOnly: !actor.options.full })
        updates = rows.map((row) => ({ row: row.y }))
        actor.rebuilt += rows.length
        return
      }
      assert.equal(
        actor.api.buildZigFrame(actor.builder, actor.atlas, actor.rasterizer, actor.options),
        0,
      )
      updates = actor.builder.changedRanges()
      actor.rebuilt += actor.builder.rowRebuilds ?? 12
      if (publication === 'canvas')
        rows = actor.state.readRows({ rows: new Set(updates.map((update) => update.row)) })
    },
    measured,
  )
  stage(
    actor,
    backend === 'canvas' ? 'canvas-commands' : 'gl-commands',
    () => {
      if (actor.painter) {
        for (const row of rows) actor.painter.paint(row, undefined, 640)
        return
      }
      actor.pass.syncAtlas(actor.atlas.consumeUploads())
      const operations = actor.pass.uploadFrame(actor.builder, updates)
      if (operations > 0) actor.pass.submit()
    },
    measured,
  )
  actor.state.acknowledge()
  actor.options.full = false
  stage(
    actor,
    'publication',
    () => {
      if (publication !== 'none')
        actor.observer.emit(
          actor.state,
          actor.state.readCursor(),
          undefined,
          updates.map((update) => update.row),
          rows,
        )
    },
    measured,
  )
}

function runTicks(actors, limit, measured) {
  for (let index = 0; index < limit; index += 1)
    for (const actor of actors) tick(actor, index, measured)
}

function disposeActor(actor) {
  actor.builder.dispose()
  actor.state.dispose()
  actor.terminal.dispose()
  actor.pass.destroy()
}

const reusableActors = new Map()

function finalProof(actor) {
  if (backend === 'canvas')
    assert.equal(
      actor.api.buildZigFrame(actor.builder, actor.atlas, actor.rasterizer, {
        ...actor.options,
        full: true,
      }),
      0,
    )
  const textRows = actor.state.readRows({ packed: true })
  const text = textRows.map((row) => row.cells.map((cell) => cell.text).join('')).join('\n')
  const cells = Buffer.from(
    actor.builder.cellData.buffer,
    actor.builder.cellData.byteOffset,
    actor.builder.cellData.byteLength,
  )
  const glyphs = Buffer.from(
    actor.builder.glyphData.buffer,
    actor.builder.glyphData.byteOffset,
    actor.builder.glyphData.byteLength,
  )
  const savedCells = Buffer.from(cells)
  const savedGlyphs = Buffer.from(glyphs)
  assert.equal(
    actor.api.buildZigFrame(actor.builder, actor.atlas, actor.rasterizer, {
      ...actor.options,
      full: true,
    }),
    0,
  )
  assert(
    savedCells.equals(
      Buffer.from(
        actor.builder.cellData.buffer,
        actor.builder.cellData.byteOffset,
        actor.builder.cellData.byteLength,
      ),
    ),
    'incremental cells equal full rebuild',
  )
  assert(
    savedGlyphs.equals(
      Buffer.from(
        actor.builder.glyphData.buffer,
        actor.builder.glyphData.byteOffset,
        actor.builder.glyphData.byteLength,
      ),
    ),
    'incremental glyphs equal full rebuild',
  )
  const retained = createHash('sha256')
  for (let start = 0; start < actor.terminal.totalRows; start += 1024)
    retained.update(
      JSON.stringify(
        actor.terminal.readLines(start, Math.min(actor.terminal.totalRows, start + 1024), {
          trimRight: false,
        }),
      ),
    )
  return {
    textDigest: createHash('sha256').update(text).digest('hex'),
    retainedDigest: retained.digest('hex'),
    frameDigest: createHash('sha256').update(savedCells).update(savedGlyphs).digest('hex'),
    history: actor.terminal.scrollbackLength,
    deliveredRows: actor.delivered()?.rows.length ?? 0,
  }
}

try {
  const boundarySamples = []
  for (let index = 0; index < 64; index += 1) {
    counter.start()
    boundarySamples.push(checkedStop())
  }
  await appendFile(
    output,
    `${JSON.stringify({ kind: 'boundary-calibration', samples: boundarySamples, scope: 'Empty start/stop brackets; raw counts retained, no subtraction.' })}\n`,
  )
  for (let index = 0; index < 32; index += 1) {
    counter.start()
    counter.busy(10000)
    checkedStop()
  }
  for (let index = 0; index < 8; index += 1) {
    counter.start()
    counter.busy(1000000)
    const one = checkedStop()
    counter.start()
    counter.busy(2000000)
    const two = checkedStop()
    await appendFile(
      output,
      `${JSON.stringify({ kind: 'calibration', index, one, two, expectedInstructionIncrement: 3000000, increment: two.instructions - one.instructions })}\n`,
    )
  }
  for (const [arm, api] of modules) {
    const actors = Array.from({ length: reuseActors ? count : 1 }, () => makeActor(api))
    if (reuseActors) reusableActors.set(arm, actors)
    runTicks(actors, warmTicks, Object.fromEntries(fields.map((field) => [field, 0])))
    if (!reuseActors) for (const actor of actors) disposeActor(actor)
  }
  if (get('ready-file', '')) {
    await writeFile(
      resolve(get('ready-file')),
      JSON.stringify({ pid: process.pid, warmed: true }),
      { flag: 'wx' },
    )
    const deadline = Date.now() + 60000
    for (;;) {
      try {
        await readFile(resolve(get('continue-file')))
        break
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      assert(Date.now() < deadline, 'profiler attach deadline')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  const order = arms.length === 1 ? [arms[0]] : [arms[0], arms[1], arms[1], arms[0]]
  for (let block = 0; block < repetitions; block += 1) {
    for (const [position, arm] of order.entries()) {
      const actors =
        reusableActors.get(arm) ?? Array.from({ length: count }, () => makeActor(modules.get(arm)))
      runTicks(actors, 120, Object.fromEntries(fields.map((field) => [field, 0])))
      for (const actor of actors)
        tick(actor, 0, undefined, new TextEncoder().encode('\x1b[3J\x1b[2J\x1b[H\x1b[?2027l'))
      for (const actor of actors) {
        actor.bytes = 0
        actor.rebuilt = 0
        actor.frameTicks = 0
        for (const stats of [actor.stats, actor.canvas.stats])
          for (const key of Object.keys(stats)) stats[key] = 0
      }
      globalThis.gc?.()
      const started = performance.now()
      let sample = Object.fromEntries(fields.map((field) => [field, 0]))
      if (phase === 'full') counter.start()
      runTicks(actors, ticks, sample)
      if (phase === 'full' && arm === extraArm && extraIterations) counter.busy(extraIterations)
      if (phase === 'full') sample = checkedStop()
      const elapsedMs = performance.now() - started
      const proof = actors.map(finalProof)
      const work = {
        bytes: actors.reduce((sum, actor) => sum + actor.bytes, 0),
        ticks: actors.reduce((sum, actor) => sum + actor.frameTicks, 0),
        rebuiltRows: actors.reduce((sum, actor) => sum + actor.rebuilt, 0),
        canvas: actors.reduce(
          (sum, actor) =>
            Object.fromEntries(
              Object.entries(actor.canvas.stats).map(([key, value]) => [key, sum[key] + value]),
            ),
          { calls: 0, glyphs: 0, clears: 0, backgrounds: 0 },
        ),
        gl: actors.reduce(
          (sum, actor) =>
            Object.fromEntries(
              Object.entries(actor.stats).map(([key, value]) => [key, sum[key] + value]),
            ),
          { calls: 0, uploadBytes: 0, draws: 0, instances: 0 },
        ),
      }
      const result = { kind: 'sample', block, position, arm, sample, elapsedMs, work, proof }
      await appendFile(output, `${JSON.stringify(result)}\n`)
      console.log(
        JSON.stringify({ arm, block, position, instructions: sample.instructions, elapsedMs }),
      )
      if (!reuseActors) for (const actor of actors) disposeActor(actor)
    }
  }
} finally {
  for (const actors of reusableActors.values()) for (const actor of actors) disposeActor(actor)
  counter.close()
  for (const api of modules.values()) api.runtime.dispose()
}
