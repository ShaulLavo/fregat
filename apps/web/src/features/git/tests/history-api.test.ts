import { expect, test } from '../../../../test/fixtures'
import { historyRepository } from '../../../../test/factories/git-history'

test('empty repositories have no history and invalid input is rejected', async ({
  server,
  client,
}) => {
  await historyRepository(server.root)
  const empty = await client.git.history.post({ search: '', ref: 'all', path: 'history-repo' })
  expect(empty.error).toBeNull()
  expect(empty.data).toEqual({ commits: [], refs: [], next: null })
  const invalid = await client.git.history.post({ search: '', path: 'history-repo', ref: '--all' })
  expect(invalid.status).toBe(400)
  const invalidCursor = await client.git.history.post({
    search: '',
    ref: 'all',
    path: 'history-repo',
    cursor: { tips: ['--all'], skip: -1 },
  })
  expect(invalidCursor.status).toBe(400)
})

test('history includes public refs and detached HEAD, peels tags, and hides private checkpoints', async ({
  server,
  client,
}) => {
  const repo = await historyRepository(server.root)
  await repo.write('a.txt', 'initial\n')
  const initial = repo.commit('Initial commit')
  repo.git('tag', '-a', 'v1', '-m', 'Version one')
  repo.git('tag', 'blob-tag', 'HEAD:a.txt')
  const tree = repo.git('rev-parse', 'HEAD^{tree}')
  const hidden = repo.git('commit-tree', tree, '-m', 'Private checkpoint')
  repo.git('update-ref', 'refs/platform/checkpoints/test', hidden)
  const taggedOnly = repo.git('commit-tree', tree, '-m', 'Reachable through nested tag')
  repo.git('tag', '-a', 'inner', taggedOnly, '-m', 'Inner tag')
  repo.git('tag', '-a', 'outer', 'inner', '-m', 'Outer tag')
  repo.git('tag', '-d', 'inner')
  repo.git('checkout', '--detach')
  await repo.write('a.txt', 'detached\n')
  const detached = repo.commit('Detached work')
  const result = await client.git.history.post({ search: '', ref: 'all', path: 'history-repo' })
  expect(result.error).toBeNull()
  expect(result.data?.commits.map((commit) => commit.id).sort()).toEqual(
    [detached, initial, taggedOnly].sort(),
  )
  expect(result.data?.refs).toContainEqual({
    name: 'refs/tags/outer',
    kind: 'tag',
    commitId: taggedOnly,
  })
  expect(result.data?.refs).toContainEqual({ name: 'refs/tags/v1', kind: 'tag', commitId: initial })
  expect(
    result.data?.refs.some((ref) => ref.name.includes('blob-tag') || ref.name.includes('platform')),
  ).toBe(false)
  const filtered = await client.git.history.post({
    search: '',
    path: 'history-repo',
    ref: 'refs/tags/v1',
  })
  expect(filtered.data?.commits.map((commit) => commit.id)).toEqual([initial])
  const absent = await client.git.history.post({
    search: '',
    path: 'history-repo',
    ref: 'refs/heads/missing',
  })
  expect(absent.status).toBe(404)
})

test('paging pins public tips when new commits arrive and retains merge topology', async ({
  server,
  client,
}) => {
  const repo = await historyRepository(server.root)
  await repo.write('a.txt', 'base\n')
  const initial = repo.commit('Initial')
  const tree = repo.git('rev-parse', 'HEAD^{tree}')
  let tip = initial
  for (let index = 0; index < 104; index += 1)
    tip = repo.git('commit-tree', tree, '-p', tip, '-m', `Commit ${index}`)
  const side = repo.git('commit-tree', tree, '-p', initial, '-m', 'Side branch')
  const merge = repo.git('commit-tree', tree, '-p', tip, '-p', side, '-m', 'Merge side')
  repo.git('update-ref', 'refs/heads/main', merge)
  const first = await client.git.history.post({ search: '', ref: 'all', path: 'history-repo' })
  expect(first.data?.commits).toHaveLength(100)
  expect(first.data?.commits[0]?.parents).toEqual([tip, side])
  const cursor = first.data?.next
  expect(cursor).toBeTruthy()
  if (!cursor) return
  const moved = repo.git('commit-tree', tree, '-p', merge, '-m', 'Arrived between pages')
  repo.git('update-ref', 'refs/heads/main', moved)
  const second = await client.git.history.post({
    search: '',
    ref: 'all',
    path: 'history-repo',
    cursor,
  })
  expect(second.error).toBeNull()
  expect(second.data?.next).toBeNull()
  expect(second.data?.refs).toEqual([])
  const commits = [...(first.data?.commits ?? []), ...(second.data?.commits ?? [])]
  expect(commits).toHaveLength(107)
  expect(new Set(commits.map((commit) => commit.id)).size).toBe(107)
  expect(commits.some((commit) => commit.id === moved)).toBe(false)
  expect(commits.at(-1)?.id).toBe(initial)
})

test('root and rename/delete details carry exact blob pairs for the real diff endpoint', async ({
  server,
  client,
}) => {
  const repo = await historyRepository(server.root)
  await repo.write('odd\nname.txt', 'before\n')
  await repo.write('delete.txt', 'delete me\n')
  const initial = repo.commit('Initial\n\nFull message body')
  const root = await client.git.history.commit.get({
    query: { path: 'history-repo', commit: initial },
  })
  expect(root.error).toBeNull()
  expect(root.data?.parents).toEqual([])
  expect(root.data?.message).toBe('Initial\n\nFull message body')
  expect(root.data?.files).toHaveLength(2)
  const added = root.data?.files.find((file) => file.path.endsWith('odd\nname.txt'))
  expect(added).toMatchObject({
    status: 'added',
    newObjectId: repo.git('rev-parse', 'HEAD:odd\nname.txt'),
  })
  expect(added?.oldObjectId).toBeUndefined()
  repo.git('mv', 'odd\nname.txt', 'renamed.txt')
  repo.git('rm', 'delete.txt')
  const changed = repo.commit('Rename and delete')
  const details = await client.git.history.commit.get({
    query: { path: 'history-repo', commit: changed },
  })
  expect(details.error).toBeNull()
  const renamed = details.data?.files.find((file) => file.status === 'renamed')
  const deleted = details.data?.files.find((file) => file.status === 'deleted')
  expect(renamed).toMatchObject({
    path: 'history-repo/renamed.txt',
    oldPath: 'history-repo/odd\nname.txt',
  })
  expect(deleted?.newObjectId).toBeUndefined()
  expect(deleted?.oldObjectId).toBeTruthy()
  if (!renamed) return
  const diff = await client.git.diff.blob.get({
    query: {
      path: renamed.path,
      oldPath: renamed.oldPath,
      oldObjectId: renamed.oldObjectId,
      newObjectId: renamed.newObjectId,
    },
  })
  expect(diff.error).toBeNull()
  expect(diff.data?.[0]).toMatchObject({ oldText: 'before\n', newText: 'before\n' })
})

test('merge details compare first parent, not the merge base or worktree', async ({
  server,
  client,
}) => {
  const repo = await historyRepository(server.root)
  await repo.write('base.txt', 'base\n')
  repo.commit('Initial')
  repo.git('checkout', '-b', 'side')
  await repo.write('side.txt', 'side\n')
  const side = repo.commit('Side')
  repo.git('checkout', 'main')
  await repo.write('main.txt', 'main\n')
  const main = repo.commit('Main')
  repo.git('merge', '--no-ff', 'side', '-m', 'Merge')
  const merge = repo.git('rev-parse', 'HEAD')
  const result = await client.git.history.commit.get({
    query: { path: 'history-repo', commit: merge },
  })
  expect(result.error).toBeNull()
  expect(result.data?.parents).toEqual([main, side])
  expect(result.data?.files.map((file) => file.path)).toEqual(['history-repo/side.txt'])
})

test('historical file diffs work after their entire directory was removed', async ({
  server,
  client,
}) => {
  const repo = await historyRepository(server.root)
  await repo.write('removed/nested/file.txt', 'historical content\n')
  const initial = repo.commit('Add directory')
  repo.git('rm', '-r', 'removed')
  repo.commit('Remove directory')
  const details = await client.git.history.commit.get({
    query: { path: 'history-repo', commit: initial },
  })
  const file = details.data?.files[0]
  expect(file).toBeTruthy()
  if (!file) return
  const diff = await client.git.diff.blob.get({
    query: { path: file.path, newObjectId: file.newObjectId },
  })
  expect(diff.error).toBeNull()
  expect(diff.data?.[0]?.newText).toBe('historical content\n')
})

test('search covers the full history, filters literal messages and authors, and pages pinned matches', async ({
  server,
  client,
}) => {
  const repo = await historyRepository(server.root)
  await repo.write('a.txt', 'base\n')
  const initial = repo.commit('Original\n\nAn old [literal].* body')
  const tree = repo.git('rev-parse', 'HEAD^{tree}')
  let tip = initial
  for (let index = 0; index < 105; index += 1)
    tip = repo.git('commit-tree', tree, '-p', tip, '-m', `Searchable ${index}`)
  repo.git('update-ref', 'refs/heads/main', tip)
  const outside = repo.git('commit-tree', tree, '-m', 'Searchable outside')
  repo.git('update-ref', 'refs/heads/other', outside)
  const hidden = repo.git('commit-tree', tree, '-m', 'Searchable private')
  repo.git('update-ref', 'refs/platform/checkpoints/search', hidden)

  const body = await client.git.history.post({
    path: 'history-repo',
    ref: 'HEAD',
    search: '[LITERAL].*',
  })
  expect(body.error).toBeNull()
  expect(body.data?.commits.map((commit) => commit.id)).toEqual([initial])
  const author = await client.git.history.post({
    path: 'history-repo',
    ref: 'HEAD',
    search: 'HISTORY@EXAMPLE.COM',
  })
  expect(author.data?.commits).toHaveLength(100)
  expect(author.data?.next).not.toBeNull()
  const hash = await client.git.history.post({
    path: 'history-repo',
    ref: 'HEAD',
    search: initial.slice(0, 10),
  })
  expect(hash.data?.commits.map((commit) => commit.id)).toEqual([initial])
  const invisible = await client.git.history.post({
    path: 'history-repo',
    ref: 'all',
    search: hidden,
  })
  expect(invisible.data?.commits).toEqual([])
  const excluded = await client.git.history.post({
    path: 'history-repo',
    ref: 'HEAD',
    search: outside,
  })
  expect(excluded.data?.commits).toEqual([])

  const first = await client.git.history.post({
    path: 'history-repo',
    ref: 'all',
    search: 'searchable',
  })
  expect(first.error).toBeNull()
  expect(first.data?.commits).toHaveLength(100)
  const cursor = first.data?.next
  expect(cursor).toBeTruthy()
  if (!cursor) return
  const newer = repo.git('commit-tree', tree, '-p', tip, '-m', 'Searchable new arrival')
  repo.git('update-ref', 'refs/heads/main', newer)
  const second = await client.git.history.post({
    path: 'history-repo',
    ref: 'all',
    search: 'searchable',
    cursor,
  })
  expect(second.error).toBeNull()
  expect(second.data?.next).toBeNull()
  const results = [...(first.data?.commits ?? []), ...(second.data?.commits ?? [])]
  expect(results.filter((commit) => !commit.subject.startsWith('Searchable'))).toEqual([])
  expect(results.filter((commit) => commit.id === hidden || commit.id === newer)).toEqual([])
  expect(results).toHaveLength(106)
  expect(new Set(results.map((commit) => commit.id)).size).toBe(106)
  expect(
    results.some((commit) => commit.id === hidden || commit.id === newer || commit.id === initial),
  ).toBe(false)
  const missing = await client.git.history.post({
    path: 'history-repo',
    ref: 'all',
    search: '--not-a-git-option',
  })
  expect(missing.data?.commits).toEqual([])
})
