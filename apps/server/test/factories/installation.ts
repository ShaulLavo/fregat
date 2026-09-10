import { mkdir, symlink } from 'node:fs/promises'
import path from 'node:path'
import { test as base } from './ssh'

export const test = base.extend<{ installationRoot: string; homeDirectory: string }>({
  installationRoot: async ({ remoteRoot }, provide) => {
    const directory = path.join(remoteRoot, "install ' $(touch unwanted)")
    await mkdir(directory)
    const project = path.resolve(import.meta.dirname, '../../../..')
    for (const name of ['apps', 'packages', 'node_modules'])
      await symlink(path.join(project, name), path.join(directory, name))
    await provide(directory)
  },
  homeDirectory: async ({ remoteRoot }, provide) => {
    const directory = path.join(remoteRoot, 'home')
    await mkdir(directory)
    await provide(directory)
  },
})
