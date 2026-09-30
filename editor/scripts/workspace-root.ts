import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const familyRoot = fileURLToPath(new URL('..', import.meta.url))
const parentRoot = fileURLToPath(new URL('../..', import.meta.url))
export const workspaceRoot = findWorkspaceRoot()

function findWorkspaceRoot() {
  const manifest = path.join(parentRoot, 'package.json')
  if (!existsSync(manifest)) return familyRoot
  const { workspaces } = JSON.parse(readFileSync(manifest, 'utf8'))
  const packages: unknown = Array.isArray(workspaces) ? workspaces : workspaces?.packages
  if (!Array.isArray(packages)) return familyRoot
  const relative = path.relative(parentRoot, familyRoot)
  return packages.includes(`${relative}/packages/*`) ? parentRoot : familyRoot
}
