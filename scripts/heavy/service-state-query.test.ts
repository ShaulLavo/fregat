import { spawnSync } from 'node:child_process'
import { closeSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, test } from 'vitest'
import { recordEmptyServiceState, serviceState } from './service-state-query'
import { removeSandboxes, sandbox, userScopes } from './sandbox'

afterEach(removeSandboxes)

const queryAvailable = userScopes && Bun.which('systemctl') !== null
if (!queryAvailable) console.info('Service query controls require systemctl and a user manager.')

test.skipIf(!queryAvailable)(
  'actual absence remains not-found and a deliberate query failure remains empty',
  () => {
    const box = sandbox()
    const unit = `${box.sliceRoot}-absent_deadline.service`
    const file = path.join(box.root, 'query.jsonl')
    const fd = openSync(file, 'wx')
    const sink = (line: string) => writeSync(fd, line)
    try {
      expect(serviceState(unit, undefined, sink)).toBe('not-found')
      expect(readFileSync(file).byteLength).toBe(0)
      const env = {
        ...process.env,
        XDG_RUNTIME_DIR: box.root,
        DBUS_SESSION_BUS_ADDRESS: `unix:path=${box.root}/absent`,
      }
      const state = serviceState(unit, env, sink)
      expect(state).toBe('')
      expect(state).not.toBe('not-found')
      const line = readFileSync(file, 'utf8')
      expect(line).toContain('"status":1')
      expect(line).toContain('Failed to connect')
      expect(line).toContain('"text":""')
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(4096)
    } finally {
      closeSync(fd)
    }
  },
)

test.skipIf(!queryAvailable)('failed receipt IO preserves the original empty query return', () => {
  const box = sandbox()
  const file = path.join(box.root, 'closed.jsonl')
  const fd = openSync(file, 'wx')
  closeSync(fd)
  const state = serviceState(
    `${box.sliceRoot}-absent_deadline.service`,
    {
      ...process.env,
      XDG_RUNTIME_DIR: box.root,
      DBUS_SESSION_BUS_ADDRESS: `unix:path=${box.root}/absent`,
    },
    (line) => writeSync(fd, line),
  )
  expect(state).toBe('')
  expect(readFileSync(file).byteLength).toBe(0)
})

test('genuine child output is bounded with explicit preview truncation and unchanged status', () => {
  const box = sandbox()
  const result = spawnSync(
    process.execPath,
    ['-e', 'process.stderr.write("🔥".repeat(1000)); process.exit(7)'],
    { encoding: 'utf8' },
  )
  expect(result.status).toBe(7)
  const file = path.join(box.root, 'bounded.jsonl')
  const fd = openSync(file, 'wx')
  try {
    recordEmptyServiceState('fixture'.repeat(1000), result, (line) => writeSync(fd, line))
    const line = readFileSync(file, 'utf8')
    expect(Buffer.byteLength(line)).toBeLessThanOrEqual(4096)
    expect(line).toContain('"status":7')
    expect(line).toContain('"serviceTruncated":true')
    expect(line).toContain('"characters":2000,"truncated":true')
    expect(result.stderr.length).toBe(2000)
    expect(result.status).toBe(7)
  } finally {
    closeSync(fd)
  }
})

const python = Bun.which('python3')
const privatePipeAvailable = process.platform !== 'win32' && python !== null
if (!privatePipeAvailable) console.info('Private blocking-pipe controls require Unix and Python 3.')

const privatePipeControl = String.raw`import json,os,select,subprocess,sys,time
config=json.load(sys.stdin)
script="import {spawnSync} from 'node:child_process'; import {writeSync} from 'node:fs'; import {recordEmptyServiceState} from "+json.dumps(config['helper'])+"; writeSync(1,JSON.stringify({event:'identity',pid:process.pid,execPath:process.execPath,node:process.versions.node,bun:process.versions.bun??null})+'\\n'); const result=spawnSync(process.execPath,['-e','process.exit(7)'],{encoding:'utf8'}); writeSync(1,JSON.stringify({event:'query-complete',pid:result.pid,status:result.status})+'\\n'); recordEmptyServiceState('private-fixture.service',result); writeSync(1,JSON.stringify({event:'after',status:result.status})+'\\n');"
argv=[config['runtime'],'--input-type=module','-e',script]
good=subprocess.run(argv,capture_output=True,text=True,timeout=5)
assert good.returncode==0 and '"event":"after"' in good.stdout
rows=[{'mode':'ordinary','actualExit':good.returncode,'stdout':good.stdout,'stderr':good.stderr}]
for mode in ['full','broken']:
 readfd,writefd=os.pipe()
 filled=0
 if mode=='full':
  os.set_blocking(writefd,False)
  try:
   while True: filled+=os.write(writefd,b'x'*4096)
  except BlockingIOError: pass
  os.set_blocking(writefd,True)
 assert os.get_blocking(writefd)
 writerBlocking=True
 if mode=='broken': os.close(readfd);readfd=None
 child=subprocess.Popen(argv,stdout=subprocess.PIPE,stderr=writefd)
 os.close(writefd)
 seen=b'';returned=False;drained=b'';start=time.monotonic()
 try:
  deadline=start+5
  while time.monotonic()<deadline and b'"event":"after"' not in seen:
   remaining=max(0,deadline-time.monotonic())
   if not select.select([child.stdout],[],[],remaining)[0]: break
   chunk=os.read(child.stdout.fileno(),4096)
   if not chunk: break
   seen+=chunk
  returned=b'"event":"after"' in seen
  if readfd is not None:
   os.set_blocking(readfd,False)
   drained=os.read(readfd,filled)
  rest,_=child.communicate(timeout=5)
  tail=b''
  if readfd is not None:
   try: tail=os.read(readfd,4096)
   except BlockingIOError: pass
  row={'mode':mode,'pid':child.pid,'writerInheritedBlocking':writerBlocking,'filledPipeBytes':filled,'stdoutBeforeDrain':seen.decode(),'returnedBeforeReaderDrain':returned,'drainedBytes':len(drained),'stdoutAfterDrain':rest.decode(),'diagnosticAfterDrain':tail.decode(),'actualExit':child.returncode,'wallSeconds':time.monotonic()-start,'childReaped':child.poll() is not None}
  rows.append(row)
  assert returned and child.returncode==0
  if mode=='full': assert '[heavy-service-state-query]' in tail.decode()
 finally:
  if child.poll() is None: child.kill();child.wait()
  child.stdout.close()
  if readfd is not None: os.close(readfd)
print(json.dumps({'rows':rows,'privatePipeFDsClosed':True,'childrenReaped':True}))
`

test.skipIf(!privatePipeAvailable)(
  'default receipt returns before reader drain and contains closed-pipe errors',
  () => {
    const box = sandbox()
    const file = path.join(box.root, 'pipe-control.py')
    writeFileSync(file, privatePipeControl)
    const result = spawnSync(python ?? 'python3', [file], {
      encoding: 'utf8',
      input: JSON.stringify({
        runtime: process.execPath,
        helper: pathToFileURL(path.join(import.meta.dirname, 'service-state-query.ts')).href,
      }),
    })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('"writerInheritedBlocking": true')
    expect(result.stdout).toContain('"returnedBeforeReaderDrain": true')
    expect(result.stdout).toContain('"privatePipeFDsClosed": true')
    expect(result.stdout).toContain('"childrenReaped": true')
  },
)
