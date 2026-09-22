import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '../../../../test/fixtures'
import { createTestQueryClient } from '../../../../test/render'
import { admitGitMutation } from '@/features/git/utils/admit-mutation'
import { fetchStatus } from '@/features/git/utils/api'
import { gitKeys } from '@/lib/query-keys'

test('Git admission rejects a changed affected set and settles the new observation', async ({
  client,
  server,
}) => {
  execFileSync('git', ['init', '-b', 'main'], { cwd: server.root, stdio: 'pipe' })
  await writeFile(path.join(server.root, 'a.txt'), 'observed\n')
  const owner = createTestQueryClient()
  owner.setQueryData(gitKeys.status(''), await fetchStatus('', undefined, client))
  execFileSync('git', ['add', 'a.txt'], { cwd: server.root, stdio: 'pipe' })
  await expect(admitGitMutation(owner, '', ['a.txt'])).rejects.toMatchObject({ status: 409 })
  await expect(admitGitMutation(owner, '', ['a.txt'])).resolves.toMatchObject({
    files: [{ index: 'added' }],
  })
})
