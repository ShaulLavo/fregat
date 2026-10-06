import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { Socket } from 'node:net'
import { test, expect } from '../fixtures'
import {
  associateRetentionSocketFailure,
  createRetentionSocketProvenance,
  isRetentionSocketJournalName,
  retentionSocketLimits,
  snapshotRetentionSocketJournal,
} from './retention-acceptance-socket-provenance'
import {
  retentionEntryBudget,
  retentionEntryReceiptLimits,
} from './retention-acceptance-reload-transport'

function systemNode() {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(directory, process.platform === 'win32' ? 'node.exe' : 'node')
    if (!existsSync(candidate)) continue
    const result = spawnSync(
      candidate,
      ['--eval', 'process.stdout.write(process.versions.bun ? "bun" : "node")'],
      { encoding: 'utf8' },
    )
    if (result.status === 0 && result.stdout === 'node') return candidate
  }
  return null
}

test('socket evidence public request context binds duplicate paths and preserves a real reset primary', async ({
  skip,
}) => {
  const node = systemNode()
  if (!node) {
    skip('System Node is unavailable')
    return
  }
  const output = await mkdtemp(join(tmpdir(), 'retention-socket-control-'))
  const source = pathToFileURL(
    join(import.meta.dirname, 'retention-acceptance-socket-provenance.ts'),
  ).href
  const transport = pathToFileURL(
    join(import.meta.dirname, 'retention-acceptance-reload-transport.ts'),
  ).href
  const playwright = pathToFileURL(
    join(dirname(createRequire(import.meta.url).resolve('playwright/package.json')), 'index.mjs'),
  ).href
  const script = `import {createServer} from 'node:http';import {once} from 'node:events';
const [output,source,transportSource,playwrightSource]=process.argv.slice(1);
const {createRetentionSocketProvenance,snapshotRetentionSocketJournal,associateRetentionSocketFailure}=await import(source);
const {createRetentionReloadTransport,createRetentionEntryCapture,retentionEntryReceiptTime,retentionEntryModulePath}=await import(transportSource);const {request}=await import(playwrightSource);
const server=createServer((req,res)=>{if(req.url==='/reset'){req.socket.destroy();return}res.end('controlled response')});server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();
const serving=createRetentionSocketProvenance({side:'serving',entryPort:address.port,normalizePath:path=>retentionEntryModulePath(process.cwd(),path),server}),api=await request.newContext();
const ordinary={requestId:17},duplicates=[{requestId:18},{requestId:19}];let primary,observed;
const archive=createRetentionEntryCapture({entryPort:address.port,root:process.cwd()});archive.begin(output);archive.accept({...retentionEntryReceiptTime(),kind:'socket-journal',basename:serving.basename});
try{await archive.observeForward(output,ordinary,()=>api.get('http://127.0.0.1:'+address.port+'/good?private-sentinel'));archive.endForward(ordinary);
await Promise.all(duplicates.map(observation=>archive.observeForward(output,observation,()=>api.get('http://127.0.0.1:'+address.port+'/same')).finally(()=>archive.endForward(observation))));
const transport=createRetentionReloadTransport({run:(observation,operation)=>archive.observeForward(output,observation,operation),settled:observation=>archive.endForward(observation)});
const running=transport.run('http://127.0.0.1:'+address.port+'/reset',async fulfill=>{try{await api.get('http://127.0.0.1:'+address.port+'/reset')}catch(error){primary=error;throw error}await fulfill(async()=>{})},async()=>{});
try{await transport.race(running)}catch(error){observed=error}await transport.drain();
archive.accept({...retentionEntryReceiptTime(),kind:'route-failure',transportRequestId:1,path:'/apps/web/reset'});const immediate=await archive.fail(output,'reload');archive.end(output);await archive.persistFailures();const evidence=JSON.parse(await (await import('node:fs/promises')).readFile(output+'/socket-provenance.json','utf8'));const clientSnapshot=evidence.frozen.client,servingSnapshot=evidence.frozen.serving;
process.stdout.write(JSON.stringify({identity:observed===primary&&transport.firstError===primary,clientSnapshot,servingSnapshot,association:associateRetentionSocketFailure(output,clientSnapshot,servingSnapshot,1,1),client:archive.inspect().socketJournal,serving:serving.inspect(),immediate,archivalAssociation:evidence.frozen.association}));
}finally{archive.dispose();await api.dispose();await new Promise(resolve=>server.close(resolve));serving.close();serving.remove()}`
  const child = spawn(
    node,
    [
      '--experimental-strip-types',
      '--disable-warning=ExperimentalWarning',
      '--input-type=module',
      '--eval',
      script,
      output,
      source,
      transport,
      playwright,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const closed = once(child, 'close')
  let stdout = '',
    stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000)
  try {
    const [code, signal] = await closed
    clearTimeout(timer)
    expect(code, stderr).toBe(0)
    expect(signal).toBeNull()
    const result = JSON.parse(stdout)
    expect(result.identity).toBe(true)
    expect(result.immediate.status).toBe('written')
    expect(result.archivalAssociation.status).toBe('exact')
    expect(result.clientSnapshot.status, stdout).toBe('written')
    expect(result.servingSnapshot.status, stdout).toBe('written')
    expect(result.clientSnapshot.partial + result.servingSnapshot.partial).toBe(0)
    const association = result.association
    expect(association).toMatchObject({
      status: 'exact',
      client: { forwardId: 1, association: 'context', path: '/apps/web/reset' },
      serving: { path: '/apps/web/reset' },
    })
    expect(association.clientSocket.localPort).toBe(association.servingSocket.remotePort)
    expect(association.clientSocket.remotePort).toBe(association.servingSocket.localPort)
    expect(association.client.order).toBe(association.serving.order)
    const clientText = await readFile(join(output, result.clientSnapshot.basename), 'utf8')
    expect(clientText).not.toContain('private-sentinel')
    expect(clientText).not.toContain('controlled response')
    const rows = clientText
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    expect(
      rows
        .filter((row) => row.kind === 'request' && row.path === '/apps/web/same')
        .map((row) => row.forwardId)
        .sort(),
    ).toEqual([18, 19])
    for (const side of ['client', 'serving'] as const) {
      expect(result[side].retainedRecords).toBeLessThanOrEqual(retentionSocketLimits[side].records)
      expect(result[side].retainedBytes).toBeLessThanOrEqual(retentionSocketLimits[side].bytes)
    }
    const servingText = await readFile(join(output, result.servingSnapshot.basename), 'utf8')
    const servingRows = servingText
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'request',
          forwardId: 17,
          association: 'context',
          path: '/apps/web/good',
        }),
      ]),
    )
    expect(servingRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'request',
          path: '/apps/web/good',
          status: 200,
          complete: true,
        }),
      ]),
    )
    await writeFile(
      join(output, result.servingSnapshot.basename),
      servingText +
        JSON.stringify({ ...association.servingSocket, id: association.servingSocket.id + 10000 }) +
        '\n',
    )
    expect(
      associateRetentionSocketFailure(output, result.clientSnapshot, result.servingSnapshot, 1, 1),
    ).toMatchObject({ status: 'ambiguous', why: 'reversed-endpoint-incarnation' })
    await writeFile(join(output, result.servingSnapshot.basename), servingText)
    await writeFile(
      join(output, result.clientSnapshot.basename),
      clientText +
        JSON.stringify({ ...association.client, id: association.client.id + 10000 }) +
        '\n',
    )
    expect(
      associateRetentionSocketFailure(output, result.clientSnapshot, result.servingSnapshot, 1, 1),
    ).toMatchObject({ status: 'ambiguous', why: 'forward-request-identity' })
    await writeFile(join(output, result.clientSnapshot.basename), clientText)
    expect(
      associateRetentionSocketFailure(
        output,
        { ...result.clientSnapshot, partial: 1 },
        result.servingSnapshot,
        1,
        1,
      ),
    ).toMatchObject({ status: 'unavailable', why: 'journal-incomplete' })
    expect(
      associateRetentionSocketFailure(
        output,
        result.clientSnapshot,
        {
          ...result.servingSnapshot,
          coverage: {
            ...result.servingSnapshot.coverage,
            evictedSocketThrough: association.clientSocket.opened[1],
          },
        },
        1,
        1,
      ),
    ).toMatchObject({ status: 'unavailable', why: 'peer-incarnation-history-evicted' })
  } finally {
    clearTimeout(timer)
    await rm(output, { recursive: true, force: true })
  }
})

test('socket evidence emit return/arguments/default unhandled identity and cleanup remain original', () => {
  const emit = Socket.prototype.emit
  const descriptor = Object.getOwnPropertyDescriptor(Socket.prototype, 'emit')
  const collector = createRetentionSocketProvenance({
    side: 'client',
    entryPort: 52865,
    normalizePath: (path) => path,
  })
  const socket = new Socket()
  const primary = (() => {
    try {
      JSON.parse('controlled primary')
    } catch (error) {
      return error
    }
  })()
  try {
    expect(socket.emit('no-subscriber', 1)).toBe(false)
    const argument = { value: 1 }
    let received: unknown
    socket.on('control', function (this: Socket, value: unknown) {
      expect(this).toBe(socket)
      received = value
    })
    expect(socket.emit('control', argument)).toBe(true)
    expect(received).toBe(argument)
    let observed: unknown
    try {
      socket.emit('error', primary)
    } catch (error) {
      observed = error
    }
    expect(observed).toBe(primary)
    expect(socket.listenerCount('error')).toBe(0)
    expect(process.stdout.listenerCount('error')).toBe(0)
    collector.close()
    expect(Socket.prototype.emit).toBe(emit)
    expect(Object.getOwnPropertyDescriptor(Socket.prototype, 'emit')).toEqual(descriptor)
  } finally {
    collector.close()
    collector.remove()
  }
})

test('socket evidence bounded active capsules refuse observation while returning original values', () => {
  const collector = createRetentionSocketProvenance({
    side: 'client',
    entryPort: 52865,
    normalizePath: (path) => path,
  })
  const value = Promise.resolve('original')
  try {
    for (let requestId = 1; requestId <= 10000; requestId++) {
      expect(collector.runForward(1, { requestId }, () => value)).toBe(value)
      expect(collector.inspect().retainedRecords).toBeLessThanOrEqual(
        retentionSocketLimits.client.records,
      )
      expect(collector.inspect().retainedBytes).toBeLessThanOrEqual(
        retentionSocketLimits.client.bytes,
      )
    }
    expect(collector.inspect().referenceRefused).toBeGreaterThan(0)
  } finally {
    collector.close()
    collector.remove()
  }
})

test('socket evidence unavailable journal IO preserves an operation and default error', async () => {
  const output = await mkdtemp(join(tmpdir(), 'retention-socket-io-'))
  const collector = createRetentionSocketProvenance({
    side: 'client',
    entryPort: 52865,
    normalizePath: (path) => path,
  })
  const primary = (() => {
    try {
      JSON.parse('controlled primary')
    } catch (error) {
      return error
    }
  })()
  try {
    collector.close()
    collector.remove()
    let observed: unknown
    try {
      collector.runForward(1, { requestId: 1 }, () => {
        throw primary
      })
    } catch (error) {
      observed = error
    }
    expect(observed).toBe(primary)
    expect(snapshotRetentionSocketJournal(collector.basename, output, 'frozen')).toMatchObject({
      status: 'unavailable',
      code: 'ENOENT',
    })
    expect(isRetentionSocketJournalName('../private.json')).toBe(false)
  } finally {
    collector.close()
    collector.remove()
    await rm(output, { recursive: true, force: true })
  }
})

test('socket evidence shares the exact original aggregate record and byte allowance', () => {
  const budgets = [
    retentionEntryBudget.producer,
    retentionEntryBudget.clientJournal,
    retentionEntryBudget.servingJournal,
    retentionEntryBudget.relay,
  ]
  expect(budgets.reduce((sum, budget) => sum + budget.records, 0)).toBe(
    retentionEntryReceiptLimits.records,
  )
  expect(budgets.reduce((sum, budget) => sum + budget.bytes, 0)).toBe(
    retentionEntryReceiptLimits.bytes,
  )
  expect(retentionEntryBudget.producer).toEqual({ records: 70, bytes: 286745, factCells: 64 })
  expect(retentionEntryBudget.relay).toEqual({ records: 16698, bytes: 2858983 })
})
