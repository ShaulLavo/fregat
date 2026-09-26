import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '../../../../test/fixtures'
import { createTestQueryClient } from '../../../../test/render'
import { admitDiscard } from '@/features/git/utils/admit-mutation'
import { fetchStatus } from '@/features/git/utils/api'
import { gitKeys } from '@/lib/query-keys'
import { runGit } from '../../../../test/factories/git'

test('Discard admission rejects a changed affected set and settles the new observation', async ({
  client,
  server,
}) => {
  runGit(server.root, ['init', '-b', 'main'], { cwdMode: 'option' })
  await writeFile(path.join(server.root, 'a.txt'), 'observed\n')
  const owner = createTestQueryClient()
  owner.setQueryData(gitKeys.status(''), await fetchStatus('', undefined, client))
  runGit(server.root, ['add', 'a.txt'], { cwdMode: 'option' })
  await expect(admitDiscard(owner, '', ['a.txt'])).rejects.toMatchObject({ status: 409 })
  await expect(admitDiscard(owner, '', ['a.txt'])).resolves.toMatchObject({
    files: [{ index: 'added' }],
  })
})
