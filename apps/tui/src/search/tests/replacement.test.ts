import { createControlledInProcessTransport } from '../../../test/client'
import { makeTestServer } from '../../../test/server'
import { createEnvironmentClient } from '@workspace/client-core/transport/client'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { test, expect } from '../../../test/fixtures'
import { prepareReplacement, applyReplacement } from '@/search/state/replacement'
import { replacementText } from '@/search/utils/replacement'
import { searchQuery } from '@/search/utils/results'
import { createSearchWorkbench } from '@/search/state/workbench'

const query = searchQuery('', {
  query: 'needle',
  include: '*.txt',
  exclude: '',
  regex: false,
  caseSensitive: true,
  wholeWord: true,
})

test('replacement applies one transaction across files and snapshot checks reject a changed preview', async ({
  server,
  client,
}) => {
  await writeFile(`${server.root}/a.txt`, 'needle needlework\r\nneedle\r\n')
  await writeFile(`${server.root}/b.txt`, 'needle\n')
  const store = createSearchWorkbench(client)
  const signal = new AbortController().signal
  try {
    await store.search(query)
    const matches = store.getSnapshot().matches
    const stale = await prepareReplacement({ client, query, matches, replacement: 'pin', signal })
    expect(stale.count).toBe(3)
    await writeFile(`${server.root}/b.txt`, 'needle newer\n')
    await expect(applyReplacement(stale)).rejects.toThrow()
    expect(await readFile(`${server.root}/a.txt`, 'utf8')).toBe('needle needlework\r\nneedle\r\n')
    const fresh = await prepareReplacement({ client, query, matches, replacement: 'pin', signal })
    await applyReplacement(fresh)
    expect(await readFile(`${server.root}/a.txt`, 'utf8')).toBe('pin needlework\r\npin\r\n')
    expect(await readFile(`${server.root}/b.txt`, 'utf8')).toBe('pin newer\n')
  } finally {
    store.dispose()
  }
})

test('regex replacement supports captures and preserves nonmatching text', () => {
  expect(
    replacementText(
      'ab12 ab34\n',
      { ...query, query: 'ab(\\d+)', matchMode: 'regex', wholeWord: false },
      'id-$1',
    ),
  ).toEqual({ content: 'id-12 id-34\n', count: 2 })
})

test('replacement in a nested workspace changes only the searched target', async ({
  server,
  client,
}) => {
  await mkdir(`${server.root}/project/project`, { recursive: true })
  await mkdir(`${server.root}/project-other`)
  await writeFile(`${server.root}/project/sample.txt`, 'needle\n')
  await writeFile(`${server.root}/sample.txt`, 'needle outside\n')
  await writeFile(`${server.root}/project-other/sample.txt`, 'needle sibling\n')
  await writeFile(`${server.root}/project/project/sample.txt`, 'nested copy\n')
  const scopedQuery = { ...query, path: 'project' }
  const store = createSearchWorkbench(client)
  const signal = new AbortController().signal
  try {
    await store.search(scopedQuery)
    const matches = store.getSnapshot().matches
    expect(matches.map((match) => match.path)).toEqual(['project/sample.txt'])
    const plan = await prepareReplacement({
      client,
      query: scopedQuery,
      matches,
      replacement: 'pin',
      signal,
    })
    await applyReplacement(plan)
    expect(await readFile(`${server.root}/project/sample.txt`, 'utf8')).toBe('pin\n')
    expect(await readFile(`${server.root}/sample.txt`, 'utf8')).toBe('needle outside\n')
    expect(await readFile(`${server.root}/project-other/sample.txt`, 'utf8')).toBe(
      'needle sibling\n',
    )
    expect(await readFile(`${server.root}/project/project/sample.txt`, 'utf8')).toBe(
      'nested copy\n',
    )
  } finally {
    store.dispose()
  }
})

test.for([
  ['b', '(a)?b', '$1x'],
  ['b', '(?<name>a)?b', '$<name>x'],
  ['a', '(?<name>a)', '$<missing>/$<>'],
  ['a', '(a)', '$<missing>'],
  ['a', '(a)', '$<missing$1>'],
  ['a', '(a)', '$10/$01/$0/$00'],
  ['b', '(a)?b', '$12'],
  ['abcdefghij', '(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)', '$10/$99/$09'],
  ['before ab after', '(a)(b)', "$`/$&/$'/$$/$2$1"],
])(
  'regex capture expansion matches native replacement for %s / %s / %s',
  ([text, pattern, replacement]) => {
    const result = replacementText(
      text,
      { ...query, query: pattern, matchMode: 'regex', wholeWord: false },
      replacement,
    )
    expect(result.content).toBe(text.replace(new RegExp(pattern, 'gu'), replacement))
  },
)

test('cancellation after disk commit still finalizes and releases the transaction', async ({
  server,
}) => {
  await writeFile(`${server.root}/a.txt`, 'needle\n')
  const transport = createControlledInProcessTransport(server)
  const client = createEnvironmentClient({
    origin: server.origin,
    headers: () => ({ origin: server.clientOrigin }),
    fetcher: transport.fetcher,
  })
  const controller = new AbortController()
  const plan = await prepareReplacement({
    client,
    query,
    matches: [
      {
        path: 'a.txt',
        kind: 'content',
        source: 'disk',
        type: 'file',
        line: 1,
        column: 1,
        endColumn: 7,
      },
    ],
    replacement: 'pin',
    signal: controller.signal,
  })
  const gate = transport.pauseNextResponse('/fs/workspace-edit/commit')
  try {
    const applying = applyReplacement(plan)
    await gate.reached
    controller.abort()
    gate.release()
    const result = await applying
    expect(result.state).toBe('released')
    expect(await readFile(`${server.root}/a.txt`, 'utf8')).toBe('pin\n')
    const next = await prepareReplacement({
      client,
      query: { ...query, query: 'pin' },
      matches: [{ path: 'a.txt', kind: 'content', source: 'disk', type: 'file' }],
      replacement: 'done',
      signal: new AbortController().signal,
    })
    await expect(applyReplacement(next)).resolves.toMatchObject({ state: 'released' })
  } finally {
    gate.release()
  }
})

test('prepared replacement retains its owner and inputs and submits only once', async ({
  server,
}) => {
  const other = await makeTestServer()
  const transport = createControlledInProcessTransport(server)
  const client = createEnvironmentClient({
    origin: server.origin,
    headers: () => ({ origin: server.clientOrigin }),
    fetcher: transport.fetcher,
  })
  const capturedQuery = { ...query }
  await writeFile(`${server.root}/a.txt`, 'needle\n')
  await writeFile(`${other.root}/a.txt`, 'needle on other server\n')
  const read = transport.pauseNextResponse('/fs/read')
  try {
    const preparing = prepareReplacement({
      client,
      query: capturedQuery,
      matches: [{ path: 'a.txt', kind: 'content', source: 'disk', type: 'file' }],
      replacement: 'pin',
      signal: new AbortController().signal,
    })
    await read.reached
    capturedQuery.path = 'another-root'
    capturedQuery.query = 'different'
    read.release()
    const plan = await preparing
    expect(Object.isFrozen(plan.operations)).toBe(true)
    expect(Object.isFrozen(plan.operations[0])).toBe(true)
    const applying = applyReplacement(plan)
    expect(applyReplacement(plan)).toBe(applying)
    await applying
    expect(applyReplacement(plan)).toBe(applying)
    expect(await readFile(`${server.root}/a.txt`, 'utf8')).toBe('pin\n')
    expect(await readFile(`${other.root}/a.txt`, 'utf8')).toBe('needle on other server\n')
    expect(
      transport.requests.filter(
        (request) => new URL(request.url).pathname === '/fs/workspace-edit/commit',
      ),
    ).toHaveLength(1)
  } finally {
    read.release()
    await other.cleanup()
  }
})
