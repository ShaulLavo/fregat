import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { cpus, totalmem, platform, release, arch } from 'node:os'
import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
import { root, output } from './build.mjs'
import { readServedBuilds, verifyResume, sourceIdentity } from './provenance.mjs'
import { verifyFullDocumentRow } from './full-document.mjs'
import { installOpenProbe, summarizeOpenProfile } from './open-profile.mjs'
import { outputProof, verifyOutputEquality } from './output-proof.mjs'
import { corpora } from './fixture.mjs'
import { monitorProcessMemory, processMemoryBytes } from './memory.mjs'
import {
  fixtureIdentity,
  order,
  sizes,
  summarize,
  scrollCosts,
  scrollTraceName,
  verifyGeometry,
} from './protocol.mjs'

const { values } = parseArgs({
  options: {
    output: { type: 'string', default: resolve(root, 'results') },
    resume: { type: 'boolean', default: false },
    condition: { type: 'string', default: 'unspecified' },
    sizes: { type: 'string', default: sizes.join(',') },
    repetitions: { type: 'string', default: '3' },
    keys: { type: 'string', default: '40' },
    'scroll-frames': { type: 'string', default: '120' },
    timeout: { type: 'string', default: '60000' },
    'delay-ms': { type: 'string', default: '0' },
    'executable-path': { type: 'string' },
    'profile-open': { type: 'boolean', default: false },
    'full-document': { type: 'boolean', default: false },
    'open-only': { type: 'boolean', default: false },
    corpus: { type: 'string', default: 'repeated' },
    editors: { type: 'string', default: 'singapore,monaco,codemirror' },
    warm: { type: 'boolean', default: false },
    lifecycle: { type: 'boolean', default: false },
  },
})
const selectedEditors = values.editors.split(',')
const selected = values.sizes.split(',').map(Number)
const repetitions = Number(values.repetitions)
const keys = Number(values.keys)
const frames = Number(values['scroll-frames'])
const timeout = Number(values.timeout)
if (
  !corpora.includes(values.corpus) ||
  (values.lifecycle && (!values['full-document'] || selectedEditors.join(',') !== 'singapore')) ||
  selectedEditors.some((editor) => !['singapore', 'monaco', 'codemirror'].includes(editor)) ||
  new Set(selectedEditors).size !== selectedEditors.length ||
  ((values.corpus !== 'repeated' || values.warm) &&
    (!values['full-document'] || selectedEditors.join(',') !== 'singapore')) ||
  (values['full-document'] && (!values['profile-open'] || !values['open-only'])) ||
  (values['open-only'] && !values['profile-open']) ||
  !['quiet', 'noisy', 'unspecified'].includes(values.condition) ||
  selected.some((size) => !sizes.includes(size)) ||
  new Set(selected).size !== selected.length ||
  !Number.isFinite(Number(values['delay-ms'])) ||
  Number(values['delay-ms']) < 0 ||
  ![repetitions, keys, frames, timeout].every((n) => Number.isSafeInteger(n) && n > 0)
)
  throw new RangeError('Use positive integer counts and fixture sizes from 1,10,50,100,200')
await mkdir(values.output, { recursive: true })
const mode = JSON.parse(await readFile(resolve(output, 'mode.json'), 'utf8'))
if (mode.fullDocument !== values['full-document'])
  throw new RangeError('Rebuild with the requested full-document mode')
if (mode.sourceSha256 !== (await sourceIdentity(root)))
  throw new RangeError('Rebuild after changing benchmark or package sources')
const builds = await readServedBuilds(output)
const server = createServer(async (request, response) => {
  const path = resolve(output, `.${new URL(request.url, 'http://localhost').pathname}`)
  if (!path.startsWith(`${output}/`)) {
    response.writeHead(403).end()
    return
  }
  const content = await readFile(path).catch(() => null)
  if (!content) {
    response.writeHead(404).end()
    return
  }
  response.setHeader(
    'Content-Type',
    {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.wasm': 'application/wasm',
    }[extname(path)] ?? 'application/octet-stream',
  )
  response.end(content)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
let browser = await chromium.launch({ headless: true, executablePath: values['executable-path'] })
let results = {
  label: `${values.condition === 'noisy' ? 'Noisy experiment' : 'Experiment'}, headless Linux Chromium. Frame opportunity proxy, not physical presentation latency.`,
  date: new Date().toISOString(),
  machine: {
    cpu: cpus()[0].model,
    logicalCpus: cpus().length,
    memoryBytes: totalmem(),
    platform: platform(),
    kernel: release(),
    arch: arch(),
  },
  browser: browser.version(),
  tooling: {
    node: process.version,
    bun: execFileSync('bun', ['--version'], { encoding: 'utf8' }).trim(),
  },
  versions: Object.fromEntries(
    await Promise.all(
      [
        ['@singapore-editor/core', '../../packages/editor/package.json'],
        ['@singapore-editor/textbuffer', '../../packages/textbuffer/package.json'],
        ['@singapore-editor/tree-sitter', '../../packages/tree-sitter/package.json'],
        [
          '@singapore-editor/tree-sitter-languages',
          '../../packages/tree-sitter-languages/package.json',
        ],
        ...[
          'monaco-editor',
          'codemirror',
          '@codemirror/state',
          '@codemirror/view',
          '@codemirror/lang-javascript',
          'playwright',
          'vite',
        ].map((name) => [name, `node_modules/${name}/package.json`]),
      ].map(async ([name, file]) => [
        name,
        JSON.parse(await readFile(resolve(root, file), 'utf8')).version,
      ]),
    ),
  ),
  rootLockSha256: createHash('sha256')
    .update(await readFile(resolve(root, '../../../bun.lock')))
    .digest('hex'),
  benchmarkSha256: createHash('sha256')
    .update(
      (
        await Promise.all(
          [
            'memory.mjs',
            'retention.mjs',
            'output-proof.mjs',
            'full-document.mjs',
            'native-full-parse.c',
            'build.mjs',
            'page.html',
            'package.json',
            'page.js',
            'fixture.mjs',
            'singapore.js',
            'monaco.js',
            'codemirror.js',
            'protocol.mjs',
            'provenance.mjs',
            'run.mjs',
            'open-profile.mjs',
            'summarize.mjs',
            'summarize-open.mjs',
            'verify-control.mjs',
            '../../../bun.lock',
          ].map((file) => readFile(resolve(root, file))),
        )
      )
        .map((bytes) => bytes.toString())
        .join('\0'),
    )
    .digest('hex'),
  git: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  dirtySource: execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  transformSha256: createHash('sha256')
    .update(await readFile(resolve(root, 'full-document.mjs')))
    .digest('hex'),
  config: {
    lifecycle: values.lifecycle,
    condition: values.condition,
    profileOpen: values['profile-open'],
    fullDocument: values['full-document'],
    openOnly: values['open-only'],
    corpus: values.corpus,
    editors: selectedEditors,
    startup: values.warm ? 'warm-runtime-fresh-document' : 'cold-context',
    selected,
    repetitions,
    keys,
    frames,
    timeout,
    delayMs: Number(values['delay-ms']),
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  },
  fixtures: selected.map((mib) => fixtureIdentity(mib, values.corpus)),
  builds,
  buildMode: mode,
  bundles: JSON.parse(await readFile(resolve(output, 'bundles.json'), 'utf8')),
  samples: [],
}

async function trace(cdp, operation, profile = false) {
  await cdp.send('Tracing.start', {
    categories: profile
      ? 'toplevel,devtools.timeline,blink.user_timing,disabled-by-default-v8.cpu_profiler'
      : 'devtools.timeline,blink.user_timing',
    transferMode: 'ReturnAsStream',
  })
  const completed = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve))
  const result = await operation()
  await cdp.send('Tracing.end')
  const { stream } = await completed
  let data = ''
  while (true) {
    const chunk = await cdp.send('IO.read', { handle: stream })
    data += chunk.data
    if (chunk.eof) break
  }
  await cdp.send('IO.close', { handle: stream })
  return { result, events: JSON.parse(data).traceEvents }
}

async function workerRequest(connection, sessionId, method, id) {
  let listener
  let timer
  const response = new Promise((resolve, reject) => {
    listener = (event) => {
      if (event.sessionId !== sessionId) return
      const message = JSON.parse(event.message)
      if (message.id !== id) return
      if (message.error) reject(new RangeError(message.error.message))
      else resolve(message.result)
    }
    connection.on('Target.receivedMessageFromTarget', listener)
    timer = setTimeout(() => reject(new RangeError(`Worker ${method} exceeded deadline`)), timeout)
  })
  try {
    const [, result] = await Promise.all([
      connection.send('Target.sendMessageToTarget', {
        sessionId,
        message: JSON.stringify({ id, method }),
      }),
      response,
    ])
    return result
  } finally {
    clearTimeout(timer)
    connection.off('Target.receivedMessageFromTarget', listener)
  }
}

async function heap(cdp) {
  await cdp.send('HeapProfiler.collectGarbage')
  const main = await cdp.send('Runtime.getHeapUsage')
  const connection = await browser.newBrowserCDPSession()
  const workers = []
  try {
    const targets = (await connection.send('Target.getTargets')).targetInfos.filter(
      (target) => target.type === 'worker',
    )
    for (const target of targets) {
      const { sessionId } = await connection.send('Target.attachToTarget', {
        targetId: target.targetId,
        flatten: false,
      })
      try {
        await workerRequest(connection, sessionId, 'HeapProfiler.collectGarbage', 1)
        workers.push({
          url: target.url,
          ...(await workerRequest(connection, sessionId, 'Runtime.getHeapUsage', 2)),
        })
      } finally {
        await connection.send('Target.detachFromTarget', { sessionId })
      }
    }
  } finally {
    await connection.detach()
  }
  return {
    main,
    workers,
    usedSize: main.usedSize + workers.reduce((sum, worker) => sum + worker.usedSize, 0),
    backingStorageSize:
      (main.backingStorageSize ?? 0) +
      workers.reduce((sum, worker) => sum + (worker.backingStorageSize ?? 0), 0),
  }
}

async function processMemory() {
  const connection = await browser.newBrowserCDPSession()
  try {
    const { processInfo } = await connection.send('SystemInfo.getProcessInfo')
    return await Promise.all(
      processInfo.map(async (process) => {
        const status =
          platform() === 'linux'
            ? await readFile(`/proc/${process.id}/status`, 'utf8').catch(() => '')
            : ''
        return {
          ...process,
          rssBytes: processMemoryBytes(status, 'VmRSS'),
          highWaterBytes: processMemoryBytes(status, 'VmHWM'),
        }
      }),
    )
  } finally {
    await connection.detach()
  }
}

async function profileOpen(page, cdp, row) {
  const captured = await trace(
    cdp,
    () =>
      page.evaluate(async () => {
        try {
          return { ok: true, value: await window.bench.open() }
        } catch (error) {
          return { ok: false, error: error.message }
        } finally {
          performance.mark('compare-open-capture-end')
        }
      }),
    true,
  )
  const file = `${row.editor}-${row.mib}-${row.repetition}-open.trace.json.gz`
  await writeFile(
    resolve(values.output, file),
    gzipSync(JSON.stringify({ traceEvents: captured.events })),
  )
  const probe = await page.evaluate(() => ({
    diagnostics: globalThis.__compareOpenProbe.diagnostics,
    messages: globalThis.__compareOpenProbe.messages,
    warmup: globalThis.__compareOpenProbe.warmup,
    startedAtMs: performance.getEntriesByName('compare-open-start').at(-1).startTime,
  }))
  row.openProfile = { trace: file, ...summarizeOpenProfile(captured.events, probe) }
  if (!captured.result.ok) throw new RangeError(captured.result.error)
  return captured.result.value
}

async function sample(editor, mib, repetition) {
  const row = {
    editor,
    mib,
    repetition,
    corpus: values.corpus,
    startup: results.config.startup,
    status: 'failed',
    errors: [],
  }
  const context = await browser.newContext({
    viewport: results.config.viewport,
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  page.setDefaultTimeout(timeout)
  const cdp = await context.newCDPSession(page)
  page.on('pageerror', (error) => row.errors.push(error.message))
  page.on('console', (message) => {
    if (!['warning', 'error'].includes(message.type())) return
    row.console ??= []
    if (row.console.length < 20)
      row.console.push({ type: message.type(), text: message.text().slice(0, 500) })
  })
  let stopMemory
  try {
    if (values['profile-open']) await page.addInitScript(installOpenProbe)
    await page.goto(
      `http://127.0.0.1:${port}/${editor}-typescript/index.html?delay=${results.config.delayMs}&fullDocument=${results.config.fullDocument}&corpus=${values.corpus}`,
    )
    await page.waitForFunction(() => !!window.bench)
    if (values.warm) await page.evaluate(() => window.bench.warm())
    row.heapBefore = await heap(cdp)
    row.heapBeforeBytes = row.heapBefore.usedSize
    const processIds = (await processMemory()).map((process) => process.id)
    stopMemory = monitorProcessMemory(processIds)
    await page.evaluate((mib) => window.bench.prepare(mib), mib)
    row.open = values['profile-open']
      ? await profileOpen(page, cdp, row)
      : await page.evaluate(() => window.bench.open())
    row.openMemory = await stopMemory()
    stopMemory = undefined
    if (values['full-document'] && editor === 'singapore') {
      row.outputProof = await page.evaluate(outputProof)
      verifyFullDocumentRow(row)
    }
    verifyGeometry(row.open)
    if (row.open.length !== mib * 1024 * 1024) throw new RangeError('Open changed document length')
    if (values['open-only']) {
      row.heapAfter = await heap(cdp)
      row.heapAfterBytes = row.heapAfter.usedSize
      row.heapDeltaBytes = row.heapAfterBytes - row.heapBeforeBytes
      row.processMemory = await processMemory()
      if (editor === 'singapore' && values['full-document'])
        row.retention = await page.evaluate(() => globalThis.__compareOpenProbe.inspectRetention())
      await page.screenshot({ path: resolve(values.output, `${editor}-${mib}-${repetition}.png`) })
      if (values.lifecycle) {
        stopMemory = monitorProcessMemory((await processMemory()).map((process) => process.id))
        row.lifecycle = await page.evaluate((mib) => window.bench.lifecycle(mib), mib)
        row.lifecycleMemory = await stopMemory()
        stopMemory = undefined
        row.lifecycleHeapAfter = await heap(cdp)
        row.lifecycleProcessMemory = await processMemory()
      }
      row.status = row.errors.length ? 'page-error' : 'ok'
      return row
    }
    await page.waitForTimeout(1000)
    row.heapAfter = await heap(cdp)
    row.heapAfterBytes = row.heapAfter.usedSize
    row.heapDeltaBytes = row.heapAfterBytes - row.heapBeforeBytes
    await page.screenshot({ path: resolve(values.output, `${editor}-${mib}-${repetition}.png`) })
    row.typing = {}
    for (const where of ['end', 'middle']) {
      const offset = await page.evaluate((where) => window.bench.position(where), where)
      await page.waitForTimeout(250)
      verifyGeometry({ geometry: await page.evaluate(() => window.bench.geometry()) })
      const letter = where === 'end' ? 'q' : 'z'
      const raw = []
      for (let key = 0; key < keys; key++) {
        await page.evaluate(({ letter, count }) => window.bench.arm(letter, count), {
          letter,
          count: key + 1,
        })
        await page.keyboard.press(letter)
        const value = await page.evaluate(() => window.bench.inputResult)
        if (!value.trusted) throw new RangeError('Key event was untrusted')
        if (!value.rendered) throw new RangeError('Typed glyph is missing from rendered text')
        raw.push(value)
      }
      if (
        !(await page.evaluate(
          ({ offset, keys, letter }) => window.bench.assertTyped(offset, keys, letter),
          {
            offset,
            keys,
            letter,
          },
        ))
      )
        throw new RangeError('Typed text differs from the input oracle')
      row.typing[where] = {
        inputToFrameMs: summarize(raw.map((value) => value.inputToFrameMs)),
        mutationMs: summarize(raw.map((value) => value.mutationMs)),
        raw,
      }
    }
    const captured = await trace(cdp, () =>
      page.evaluate((frames) => window.bench.scroll(frames), frames),
    )
    if (repetition === 0 && [1, 10].includes(mib))
      await writeFile(
        resolve(values.output, scrollTraceName(editor, mib)),
        gzipSync(JSON.stringify({ traceEvents: captured.events })),
      )
    const starts = captured.events
      .filter((event) => event.name === 'compare-scroll-frame')
      .map((event) => event.ts)
      .sort((a, b) => a - b)
    const scrollMarker = captured.events.find((event) => event.name === 'compare-scroll-start')
    const scrollStart = scrollMarker?.ts
    const scrollEnd = captured.events.find((event) => event.name === 'compare-scroll-end')?.ts
    row.scroll = {
      intervalsMs: summarize(captured.result.intervalsMs),
      rawIntervalsMs: captured.result.intervalsMs,
      top: captured.result.top,
      rendering: scrollCosts(
        captured.events,
        starts.filter((time) => time >= scrollStart && time <= scrollEnd),
        scrollMarker,
      ),
    }
    if (row.scroll.top < frames * 200 - 1000)
      throw new RangeError('Scroll did not reach the requested region')
    if (row.scroll.rendering.ms.n < frames - 5) throw new RangeError('Missing trace frame samples')
    verifyGeometry({ geometry: await page.evaluate(() => window.bench.geometry()) })
    row.status = row.errors.length ? 'page-error' : 'ok'
  } catch (error) {
    row.errors.push(error.message)
    row.failureFacts = await page.evaluate(() => window.bench?.facts()).catch(() => null)
  } finally {
    if (stopMemory) row.failedMemory = await stopMemory()
    await context.close().catch((error) => {
      row.errors.push(`Context cleanup: ${error.message}`)
      row.status = 'failed'
    })
  }
  return row
}

try {
  if (values.resume) {
    const previous = JSON.parse(await readFile(resolve(values.output, 'experiment.json'), 'utf8'))
    verifyResume(previous, results)
    previous.resumedAt = [...(previous.resumedAt ?? []), results.date]
    results = previous
  }
  for (const mib of selected) {
    for (let repetition = 0; repetition < repetitions; repetition++) {
      for (const editor of order(repetition).filter((editor) => selectedEditors.includes(editor))) {
        if (
          results.samples.some(
            (row) => row.editor === editor && row.mib === mib && row.repetition === repetition,
          )
        )
          continue
        const measured = sample(editor, mib, repetition).catch((error) => ({
          editor,
          mib,
          repetition,
          status: 'failed',
          errors: [error.message],
        }))
        let timer
        const row = await Promise.race([
          measured,
          new Promise((resolve) => {
            timer = setTimeout(
              () =>
                resolve({
                  editor,
                  mib,
                  repetition,
                  status: 'timeout',
                  errors: ['Whole sample exceeded deadline'],
                }),
              timeout,
            )
          }),
        ])
        clearTimeout(timer)
        results.samples.push(row)
        await writeFile(resolve(values.output, 'experiment.json'), JSON.stringify(results, null, 2))
        console.log(
          JSON.stringify({
            editor,
            mib,
            repetition,
            status: row.status,
            open: row.open?.highlightedFrameMs,
            errors: row.errors,
          }),
        )
        // A stuck evaluate cannot be cancelled safely on a shared browser process.
        if (row.status === 'timeout' || !browser.isConnected()) {
          await browser.close()
          await measured
          browser = await chromium.launch({
            headless: true,
            executablePath: values['executable-path'],
          })
        }
      }
    }
  }
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
console.log(`Experiment saved to ${resolve(values.output, 'experiment.json')}`)
if (values['full-document'] && selectedEditors.includes('singapore'))
  verifyOutputEquality(results.samples)
if (results.samples.some((row) => row.status !== 'ok')) process.exitCode = 1
