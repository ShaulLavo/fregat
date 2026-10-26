import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readWorkspaceGraph } from '../affected.mjs'

export function consumerGraph(checkout) {
  const directory = mkdtempSync(path.join(tmpdir(), 'fregat-consumer-graph-'))
  try {
    const manifest = JSON.parse(readFileSync(path.join(checkout, 'package.json'), 'utf8'))
    const packages = manifest.workspaces.packages.filter(
      (pattern) => !/^packages\/(singapore|ghostty-webgpu|hotkeys)(\/|$)/.test(pattern),
    )
    manifest.workspaces.packages = packages
    manifest.scripts['build:workspaces'] = 'turbo run build --filter=@workspace/ui'
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify(manifest))
    writeFileSync(
      path.join(directory, 'turbo.json'),
      readFileSync(path.join(checkout, 'turbo.json')),
    )
    copyManifests(checkout, directory, packages)
    return { ...readWorkspaceGraph(directory), root: checkout }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function copyManifests(checkout, directory, patterns) {
  const files = patterns.flatMap((pattern) =>
    Array.from(new Bun.Glob(`${pattern}/package.json`).scanSync({ cwd: checkout })),
  )
  for (const file of files) {
    mkdirSync(path.dirname(path.join(directory, file)), { recursive: true })
    writeFileSync(path.join(directory, file), readFileSync(path.join(checkout, file)))
    const turbo = path.join(path.dirname(file), 'turbo.json')
    if (existsSync(path.join(checkout, turbo)))
      writeFileSync(path.join(directory, turbo), readFileSync(path.join(checkout, turbo)))
  }
}
