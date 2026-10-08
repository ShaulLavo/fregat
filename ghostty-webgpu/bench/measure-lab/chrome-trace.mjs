import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'

const options = new Map()
for (let index = 2; index < process.argv.length; index += 2)
  options.set(process.argv[index], process.argv[index + 1])
const executable = resolve(options.get('--chrome'))
const output = resolve(options.get('--output'))
const headless = options.get('--headless') !== 'false'
const profile = await mkdtemp(join(output, 'profile-'))
const env = { ...process.env }
for (const key of [
  'DBUS_SESSION_BUS_ADDRESS',
  'DESKTOP_SESSION',
  'HYPRLAND_INSTANCE_SIGNATURE',
  'XDG_CURRENT_DESKTOP',
  'XDG_SEAT',
  'XDG_SEAT_PATH',
  'XDG_SESSION_CLASS',
  'XDG_SESSION_DESKTOP',
  'XDG_SESSION_ID',
  'XDG_SESSION_PATH',
  'XDG_SESSION_TYPE',
  'XDG_VTNR',
])
  delete env[key]
if (headless) for (const key of ['DISPLAY', 'WAYLAND_DISPLAY', 'SWAYSOCK']) delete env[key]
const args = [
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--remote-debugging-port=0',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--enable-thread-instruction-count',
  '--no-sandbox',
  '--ozone-platform=x11',
  '--use-angle=gl',
  '--ignore-gpu-blocklist',
  '--window-size=1200,900',
  '--disable-features=OnDeviceModel,OptimizationGuideModelDownloading,OptimizationGuideModelExecution',
  'about:blank',
]
if (headless) args.unshift('--headless=new')
const log = await import('node:fs').then(({ createWriteStream }) =>
  createWriteStream(join(output, 'chrome-stderr.log')),
)
const child = spawn(executable, args, { env, detached: true, stdio: ['ignore', 'ignore', 'pipe'] })
child.stderr.pipe(log)
const markup =
  '<!doctype html><title>m1-instrument-owned-control</title><canvas width="640" height="336"></canvas><main></main><script>for(let i=0;i<500;i++){let n=document.createElement("div");n.textContent="terminal line "+i;document.querySelector("main").append(n)};window.measureThreadInstructionControl=()=>{let sum=0;for(let i=0;i<20000000;i++)sum=(sum+i)|0;const root=document.querySelector("main");root.style.width=(300+(sum&31))+"px";let h=root.offsetHeight;let c=document.querySelector("canvas").getContext("2d");for(let i=0;i<1000;i++)c.fillText("measurement "+i,0,i%336);return {sum,h,rows:root.children.length}}</script>'
const server = createServer((request, response) =>
  response.writeHead(200, { 'content-type': 'text/html' }).end(markup),
)
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
let browser
let helper
const record = {
  headless,
  requestedArgs: args,
  browserPid: child.pid,
  flag: '--enable-thread-instruction-count',
  results: [],
}
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
async function birth(pid) {
  const text = await readFile(`/proc/${pid}/stat`, 'utf8')
  return {
    pid,
    startTicks: text.slice(text.lastIndexOf(')') + 2).split(' ')[19],
    cgroup: await readFile(`/proc/${pid}/cgroup`, 'utf8'),
  }
}
function lineServer(process) {
  let carry = ''
  const messages = []
  const waiting = []
  process.stdout.on('data', (bytes) => {
    carry += bytes
    let index
    while ((index = carry.indexOf('\n')) >= 0) {
      const message = JSON.parse(carry.slice(0, index))
      carry = carry.slice(index + 1)
      const receiver = waiting.shift()
      if (receiver) receiver(message)
      else messages.push(message)
    }
  })
  const next = () =>
    messages.length
      ? Promise.resolve(messages.shift())
      : new Promise((resolve) => waiting.push(resolve))
  return {
    next,
    request: (value) => {
      process.stdin.write(`${JSON.stringify(value)}\n`)
      return next()
    },
  }
}
try {
  const deadline = Date.now() + 20000
  let endpoint
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const text = await readFile(join(profile, 'DevToolsActivePort'), 'utf8')
      endpoint = `http://127.0.0.1:${text.split('\n')[0]}`
      break
    } catch {
      await sleep(100)
    }
  }
  assert(endpoint, 'owned Chrome CDP endpoint')
  browser = await chromium.connectOverCDP(endpoint)
  record.version = browser.version()
  record.browserBirth = await birth(child.pid)
  record.selfCgroup = await readFile('/proc/self/cgroup', 'utf8')
  const context = browser.contexts()[0]
  const page = context.pages()[0]
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  await page.waitForFunction(() => typeof window.measureThreadInstructionControl === 'function')
  assert.equal(await page.title(), 'm1-instrument-owned-control')
  for (let index = 0; index < 5; index += 1)
    await page.evaluate(() => window.measureThreadInstructionControl())
  const cdp = await browser.newBrowserCDPSession()
  const processInfo = await cdp.send('SystemInfo.getProcessInfo')
  record.processInfo = processInfo
  record.identities = []
  for (const process of processInfo.processInfo) {
    try {
      const identity = await birth(process.id)
      assert.equal(identity.cgroup, record.selfCgroup, 'Chrome stays in admitted job')
      record.identities.push({ ...identity, type: process.type })
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  const helperPath = options.get('--counter-reader')
  if (helperPath) {
    helper = spawn('python3', [resolve(helperPath)], { stdio: ['pipe', 'pipe', 'inherit'] })
    const transport = lineServer(helper)
    record.reader = await transport.next()
    record.counterSetup = await transport.request({
      command: 'start',
      pids: record.identities.map((identity) => identity.pid),
    })
    record.counterBefore = await transport.request({
      pids: record.identities.map((identity) => identity.pid),
    })
    record.counterTransport = transport
  }
  const complete = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve))
  await cdp.send('Tracing.start', {
    transferMode: 'ReturnAsStream',
    traceConfig: {
      recordMode: 'recordContinuously',
      includedCategories: [
        'toplevel',
        'blink',
        'v8',
        'devtools.timeline',
        'disabled-by-default-devtools.timeline',
        'disabled-by-default-v8.cpu_profiler',
      ],
      enableSampling: true,
    },
  })
  for (let index = 0; index < 8; index += 1) {
    record.results.push(
      await page.evaluate((index) => {
        performance.mark(`m1-start-${index}`)
        const value = window.measureThreadInstructionControl()
        performance.mark(`m1-end-${index}`)
        return value
      }, index),
    )
  }
  await cdp.send('Tracing.end')
  const { stream } = await complete
  let text = ''
  for (;;) {
    const part = await cdp.send('IO.read', { handle: stream })
    text += part.base64Encoded ? Buffer.from(part.data, 'base64').toString() : part.data
    if (part.eof) break
  }
  await cdp.send('IO.close', { handle: stream })
  if (record.counterTransport) {
    record.counterAfter = await record.counterTransport.request({
      pids: record.identities.map((identity) => identity.pid),
    })
    delete record.counterTransport
  }
  await writeFile(join(output, 'trace.json'), text)
  const events = JSON.parse(text).traceEvents
  record.events = events.length
  record.completeSlices = events.filter((event) => event.ph === 'X').length
  record.threadCpuFields = events.filter((event) => 'tdur' in event || 'tts' in event).length
  record.instructionFields = events.filter(
    (event) => 'ticount' in event || 'tidelta' in event,
  ).length
  record.eventNames = [...new Set(events.map((event) => event.name))].sort()
  record.status = record.instructionFields > 0 ? 'FLAG_WORKS' : 'FLAG_HAS_NO_INSTRUCTION_DATA'
  const observed = await readFile(`/proc/${child.pid}/cmdline`)
  record.observedFlag = observed
    .toString()
    .split('\0')
    .includes('--enable-thread-instruction-count')
} finally {
  helper?.stdin.end()
  await browser?.close()
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(5000)])
    if (child.exitCode === null) process.kill(-child.pid, 'SIGKILL')
  }
  await new Promise((resolve) => server.close(resolve))
  record.chromeStopped = child.exitCode !== null
  await writeFile(join(output, 'result.json'), `${JSON.stringify(record, null, 2)}\n`)
  console.log(
    JSON.stringify({
      version: record.version,
      headless,
      status: record.status,
      events: record.events,
      instructionFields: record.instructionFields,
      threadCpuFields: record.threadCpuFields,
    }),
  )
}
