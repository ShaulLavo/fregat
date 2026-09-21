import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export async function fingerprint(cwd) {
  const git = (args) => execFileSync('git', args, { cwd })
  const hash = createHash('sha256').update(git(['diff', 'HEAD']))
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'])
    .toString()
    .split('\0')
    .filter(Boolean)
    .sort()
  for (const file of untracked) hash.update(file).update(await readFile(resolve(cwd, file)))
  return { head: git(['rev-parse', 'HEAD']).toString().trim(), diffHash: hash.digest('hex') }
}
