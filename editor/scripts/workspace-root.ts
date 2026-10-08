import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const familyRoot = fileURLToPath(new URL('..', import.meta.url))
const parentManifest = fileURLToPath(new URL('../../package.json', import.meta.url))
const parentRoot = path.dirname(parentManifest)
export const workspaceRoot = findWorkspaceRoot()

export function workspacePatterns(workspaces: unknown): readonly string[] {
  if (Array.isArray(workspaces)) return workspaces.filter(isWorkspacePattern)
  if (typeof workspaces !== 'object' || workspaces === null || !('packages' in workspaces))
    return []
  if (!Array.isArray(workspaces.packages)) return []
  return workspaces.packages.filter(isWorkspacePattern)
}

function isWorkspacePattern(value: unknown): value is string {
  return typeof value === 'string'
}

function findWorkspaceRoot() {
  if (!existsSync(parentManifest)) return familyRoot
  const { workspaces } = JSON.parse(readFileSync(parentManifest, 'utf8'))
  const packages = workspacePatterns(workspaces)
  const relative = path.relative(parentRoot, familyRoot)
  return packages.includes(`${relative}/packages/*`) ? parentRoot : familyRoot
}
