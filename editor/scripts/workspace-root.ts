import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const familyRoot = fileURLToPath(new URL('..', import.meta.url))
const parentRoot = fileURLToPath(new URL('../..', import.meta.url))
export const workspaceRoot = existsSync(`${parentRoot}/bun.lock`) ? parentRoot : familyRoot
