import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const familyRoot = fileURLToPath(new URL('..', import.meta.url))
const enclosingManifest = fileURLToPath(new URL('../../../package.json', import.meta.url))
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
  const enclosingRoot = path.dirname(enclosingManifest)
  if (isWorkspaceRoot(enclosingRoot)) return enclosingRoot
  let parent = path.dirname(familyRoot)
  while (true) {
    if (isWorkspaceRoot(parent)) return parent
    const ancestor = path.dirname(parent)
    if (ancestor === parent) return familyRoot
    parent = ancestor
  }
}

function isWorkspaceRoot(parent: string): boolean {
  const manifest = path.join(parent, 'package.json')
  if (!existsSync(manifest)) return false
  const { workspaces } = JSON.parse(readFileSync(manifest, 'utf8'))
  const packages = workspacePatterns(workspaces)
  const relative = path.relative(parent, familyRoot)
  return packages.includes(`${relative}/packages/*`)
}
