import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'

const repository = path.resolve(import.meta.dirname, '..')

test.each(['editor', 'singapore', 'nested'])(
  'Editor scripts find their workspace in %s',
  (layout) => {
    const root = mkdtempSync(path.join(tmpdir(), 'platform-editor-root-'))
    const family = path.join(root, layout === 'nested' ? 'editor' : layout)
    const parserSource = 'github:ShaulLavo/tree-sitter-x#1234567'
    const manifest = { workspaces: ['packages/*'], name: 'editor-workspace', parserSource }
    mkdirSync(path.join(family, 'scripts'), { recursive: true })
    mkdirSync(path.join(family, 'packages'), { recursive: true })
    writeFileSync(path.join(family, 'package.json'), JSON.stringify(manifest))
    writeFileSync(path.join(family, 'turbo.json'), JSON.stringify({ tasks: {} }))
    // A lockfile beside a standalone checkout does not make its parent the workspace.
    writeFileSync(path.join(root, 'bun.lock'), '{}')
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ workspaces: ['other/*'], parserSource }),
    )
    if (layout === 'nested') {
      writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({
          workspaces: { packages: ['editor/packages/*', 'editor/examples/*'] },
          parserSource,
        }),
      )
      writeFileSync(path.join(root, 'turbo.json'), JSON.stringify({ tasks: {} }))
    }
    const scripts = ['check-turbo-inputs.mjs', 'workspace-root.ts', 'update-tree-sitter-x.ts']
    for (const file of scripts) {
      copyFileSync(
        path.join(repository, 'editor/scripts', file),
        path.join(family, 'scripts', file),
      )
    }
    try {
      const check = Bun.spawnSync(['bun', 'scripts/check-turbo-inputs.mjs'], { cwd: family })
      expect(check.exitCode, check.stderr.toString()).toBe(0)
      const result = Bun.spawnSync(
        [
          'bun',
          '-e',
          'import { workspaceRoot } from "./scripts/workspace-root.ts"; console.log(workspaceRoot)',
        ],
        { cwd: family },
      )
      expect(result.exitCode, result.stderr.toString()).toBe(0)
      expect(path.resolve(result.stdout.toString().trim())).toBe(
        layout === 'nested' ? root : family,
      )
      const bin = path.join(root, 'bin')
      mkdirSync(bin)
      const git = path.join(bin, 'git')
      writeFileSync(
        git,
        "#!/bin/sh\nprintf 'abcdef0123456789012345678901234567890123\\trefs/heads/web-tree-sitter\\n'\n",
      )
      chmodSync(git, 0o755)
      const grammar = path.join(family, 'packages/grammar')
      mkdirSync(grammar)
      writeFileSync(
        path.join(grammar, 'package.json'),
        JSON.stringify({ name: 'fixture-grammar', parserSource }),
      )
      const updater = Bun.spawnSync(['bun', 'scripts/update-tree-sitter-x.ts'], {
        cwd: family,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      })
      expect(updater.exitCode, updater.stderr.toString()).toBe(0)
      const parent = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
      expect(parent.parserSource).toBe(
        layout === 'nested' ? 'github:ShaulLavo/tree-sitter-x#abcdef0' : parserSource,
      )
      const updated = JSON.parse(readFileSync(path.join(grammar, 'package.json'), 'utf8'))
      expect(updated.parserSource).toBe('github:ShaulLavo/tree-sitter-x#abcdef0')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
)
