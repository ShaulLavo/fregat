import { homedir } from 'node:os'
import path from 'node:path'
import { installServerLauncher } from '../apps/server/src/installation/install'

const launcher = await installServerLauncher({
  homeDirectory: homedir(),
  installation: {
    kind: 'source',
    directory: path.resolve(import.meta.dirname, '..'),
    executable: process.execPath,
  },
})
process.stdout.write(`Installed ${launcher}\nConnect to this machine by its SSH address.\n`)
