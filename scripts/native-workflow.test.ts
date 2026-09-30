import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { readWorkflow } from './workflow-fixtures'

test('release rebuild paths work with two nested family checkouts', () => {
  const workflow = readWorkflow('ghostty-config-resolver.yml')
  const job = workflow.jobs['release-rebuild']!
  const root = mkdtempSync(path.join(tmpdir(), 'platform-native-checkouts-'))
  try {
    for (const checkout of ['package-source', 'native-source']) {
      const scripts = path.join(root, checkout, 'ghostty-webgpu/scripts')
      mkdirSync(path.join(scripts, 'config-resolver-native'), { recursive: true })
      writeFileSync(path.join(scripts, 'config-resolver-native/native-inputs.json'), '{}\n')
      writeFileSync(path.join(scripts, 'build-config-resolver.ts'), "console.log('built')\n")
      writeFileSync(path.join(scripts, 'create-release-provenance.ts'), "console.log('verified')\n")
    }
    for (const step of job.steps) {
      if (!step.run) continue
      const directory =
        step['working-directory'] ??
        job.defaults?.run['working-directory'] ??
        workflow.defaults?.run['working-directory'] ??
        '.'
      const cwd = path.resolve(root, directory.replace('${{ github.workspace }}', root))
      expect(existsSync(cwd), `${step.name}: ${directory}`).toBe(true)
      const commands = [
        ...step.run.matchAll(/shasum -a 256 ((?:native|package)-source\/[^\s]+)/g),
        ...step.run.matchAll(/cmp native-source\/[^\s]+ \\\n\s+package-source\/[^\s]+/g),
        ...step.run.matchAll(/cd ((?:native|package)-source[^\s]*) && bun ([^\s]+)/g),
      ].map((match) => `(${match[0]})`)
      const result = Bun.spawnSync(['bash', '-ec', 'pwd\n' + commands.join('\n')], {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
      })
      expect(result.exitCode, `${step.name}: ${result.stderr.toString()}`).toBe(0)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the native build job keeps the single family checkout default', () => {
  const workflow = readWorkflow('ghostty-config-resolver.yml')
  expect(workflow.defaults?.run['working-directory']).toBe('ghostty-webgpu')
  expect(workflow.jobs['build-native']!.defaults).toBeUndefined()
})
