import { expect, test } from '../../../test/fixtures'
import { DemoWorkspace } from '../state/workspace'
import { searchFiles } from '../utils/search'
import { eventStream } from '../transport/streams'

test('saved file versions, search results and staged content share one workspace', async () => {
  const workspace = await DemoWorkspace.create()
  const original = workspace.readFile('src/garden.ts')!
  const text = original.content + '\n// lavender verification marker\n'
  const saved = await workspace.writeFile('src/garden.ts', text, { baseVersion: original.version })
  expect(saved.version).toMatch(/^sha256:[a-f0-9]{64}$/u)
  expect(saved.version).not.toBe(original.version)
  await expect(
    workspace.writeFile('src/garden.ts', 'stale', { baseVersion: original.version }),
  ).rejects.toThrow('changed')
  const search = new URL(
    'https://fregat-demo.invalid/fs/search/events?path=/garden&query=verification%20marker&includeContent=true&includeNames=false',
  )
  expect(searchFiles(search, workspace.files)).toContainEqual(
    expect.objectContaining({
      type: 'match',
      match: expect.objectContaining({
        path: '/garden/src/garden.ts',
        preview: '// lavender verification marker',
        previewStartColumn: 0,
      }),
    }),
  )
  workspace.stage(['src/garden.ts'], true)
  await workspace.writeFile('src/garden.ts', text + '// later unstaged edit\n')
  const commit = workspace.commit('Save the garden note')
  expect(workspace.revisions.get(commit.repository.commit!)?.get('/garden/src/garden.ts')).toBe(
    text,
  )
  expect(
    workspace.gitStatus().files.find((file) => file.path.endsWith('/src/garden.ts')),
  ).toMatchObject({ index: 'unmodified', worktree: 'modified' })
})

test('quick open supports subsequences and content search respects whole words', async () => {
  const workspace = await DemoWorkspace.create()
  const fuzzy = new URL(
    'https://fregat-demo.invalid/fs/search/events?path=/garden&query=grdn&matchMode=fuzzy',
  )
  expect(searchFiles(fuzzy, workspace.files)).toContainEqual(
    expect.objectContaining({
      type: 'match',
      match: expect.objectContaining({ path: '/garden/src/garden.ts' }),
    }),
  )
  const word = new URL(
    'https://fregat-demo.invalid/fs/search/events?path=/garden&query=plant&includeContent=true&includeNames=false&wholeWord=true',
  )
  const results = searchFiles(word, workspace.files)
  expect(
    results.some(
      (event) =>
        'match' in event && event.match.preview?.trimStart().startsWith('plantingSeasons:'),
    ),
  ).toBe(false)
  expect(
    results.some((event) => 'match' in event && event.match.preview?.includes('plant.name')),
  ).toBe(true)
})

test('closing or aborting an event stream releases its subscription exactly once', async () => {
  let releases = 0
  const abort = new AbortController()
  const response = eventStream(abort.signal, () => () => {
    releases++
  })
  await response.body!.cancel()
  abort.abort()
  expect(releases).toBe(1)
  const second = new AbortController()
  const aborted = eventStream(second.signal, () => () => {
    releases++
  })
  second.abort()
  expect(await aborted.text()).toBe('')
  expect(releases).toBe(2)
})
