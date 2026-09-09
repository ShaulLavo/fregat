import { writeFile } from 'node:fs/promises'
import { createTuiError } from '@/host/utils/structured-errors'
export async function gitCommand(root: string, ...args: string[]) {
  const process = Bun.spawn(['git', '-C', root, ...args], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  if (code !== 0) throw createTuiError(stderr, 'Inspect the temporary test repository.')
  return stdout
}
export async function prepareGitWorkbench(root: string) {
  await gitCommand(root, 'init', '-q')
  await writeFile(`${root}/.git/info/exclude`, '.platform-test/\ntui/\nlogs/\n')
  await gitCommand(root, 'config', 'user.name', 'TUI Test')
  await gitCommand(root, 'config', 'user.email', 'tui@test.invalid')
  await writeFile(
    `${root}/sample.txt`,
    Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n') + '\n',
  )
  await gitCommand(root, 'add', 'sample.txt')
  await gitCommand(root, 'commit', '-qm', 'Initial fixture')
  await writeFile(
    `${root}/sample.txt`,
    Array.from({ length: 40 }, (_, index) =>
      index === 19 ? 'changed line' : `line ${index + 1}`,
    ).join('\n') + '\n',
  )
}
