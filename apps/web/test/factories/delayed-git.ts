import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runGit } from './git'

/** Hold real Git diff subprocesses in textconv until the test releases them. */
export async function delayedGitDiffs(root: string, count: number) {
  runGit(root, ['init', '--quiet'])
  const paths = Array.from({ length: count }, (_, index) => `${index}.txt`)
  for (const path of paths) await writeFile(join(root, path), 'before\n')
  runGit(root, ['add', '.'])
  runGit(root, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-qm',
    'base',
  ])
  for (const path of paths) await writeFile(join(root, path), 'after\n')
  const active = join(root, '.git', 'active-diffs')
  await mkdir(active)
  const gate = join(root, '.git', 'release-diffs')
  const script = join(root, '.git', 'hold-diff')
  await writeFile(
    script,
    `#!/bin/sh
export PATH=$HOME/.local/share/mise/shims:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
marker='${active}'/$$
touch "$marker"
trap 'rm -f "$marker"' EXIT
attempts=0
while [ ! -e '${gate}' ] && [ "$attempts" -lt 1000 ]; do
  sleep 0.02
  attempts=$((attempts + 1))
done
cat "$1"
`,
    { mode: 0o755 },
  )
  await writeFile(join(root, '.git', 'info', 'attributes'), '*.txt diff=held\n')
  runGit(root, ['config', 'diff.held.textconv', script])
  return {
    paths,
    active: () => readdir(active),
    release: () => writeFile(gate, ''),
  }
}
