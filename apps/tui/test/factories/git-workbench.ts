import { writeFile } from 'node:fs/promises'
import { runGit } from 'server/testing'
export async function prepareGitWorkbench(root: string) {
  await runGit(root, ['init', '-q'])
  await writeFile(`${root}/.git/info/exclude`, '.platform-test/\ntui/\nlogs/\n')
  await writeFile(
    `${root}/sample.txt`,
    Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n') + '\n',
  )
  await runGit(root, ['add', 'sample.txt'])
  await runGit(root, ['commit', '-qm', 'Initial fixture'])
  await writeFile(
    `${root}/sample.txt`,
    Array.from({ length: 40 }, (_, index) =>
      index === 19 ? 'changed line' : `line ${index + 1}`,
    ).join('\n') + '\n',
  )
}
