import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { SshConfigDirectories } from '../../src/machines/ssh-hosts'
import { test as base } from './ssh'

export const test = base.extend<{ sshDirectories: SshConfigDirectories }>({
  sshDirectories: async ({ remoteRoot }, provide) => {
    const homeDirectory = path.join(remoteRoot, 'home')
    const systemDirectory = path.join(remoteRoot, 'etc/ssh')
    await mkdir(path.join(homeDirectory, '.ssh'), { recursive: true })
    await mkdir(systemDirectory, { recursive: true })
    await provide({ homeDirectory, systemDirectory })
  },
})

export async function writeConfig(filename: string, contents: string) {
  await mkdir(path.dirname(filename), { recursive: true })
  await writeFile(filename, contents)
}
