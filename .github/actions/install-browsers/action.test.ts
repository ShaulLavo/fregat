import { expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const action = Bun.YAML.parse(readFileSync(path.join(import.meta.dirname, 'action.yml'), 'utf8'))
const setup = action.runs.steps.find((step: { id?: string }) => step.id === 'apt').run as string
const supported = process.platform === 'linux' && Bun.which('bash') !== null
if (!supported)
  console.info('Skipping Ubuntu package source setup tests. Linux and Bash are required.')

for (const cached of [false, true]) {
  test.skipIf(!supported)(
    `Ubuntu source selection with ${cached ? 'warm' : 'cold'} archives`,
    () => {
      const root = mkdtempSync(path.join(tmpdir(), 'browser-apt-'))
      const apt = path.join(root, 'apt')
      const archives = path.join(root, 'archives')
      const output = path.join(root, 'output')
      mkdirSync(path.join(apt, 'apt.conf.d'), { recursive: true })
      mkdirSync(archives)
      writeFileSync(
        path.join(apt, 'apt-mirrors.txt'),
        'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n' +
          'https://archive.ubuntu.com/ubuntu/\tpriority:2\n' +
          'https://security.ubuntu.com/ubuntu/\tpriority:3\n',
      )
      if (cached) writeFileSync(path.join(archives, 'dependency.deb'), 'cached dependency')
      const playwright = path.join(root, 'playwright')
      writeFileSync(playwright, '#!/usr/bin/env bash\nprintf "Version 1.63.0\\n"\n', {
        mode: 0o755,
      })
      // Only privilege and ownership operations are replaced; the action's source commands run in Bash.
      const privilege = `sudo() {
      if [ "$1" = '-u' ]; then shift 2; fi
      if [ "$1" = 'install' ]; then
        shift
        local args=()
        while [ "$#" -gt 0 ]; do
          case "$1" in
            -o|-g) shift 2 ;;
            *) args+=("$1"); shift ;;
          esac
        done
        command install "\${args[@]}"
        return
      fi
      "$@"
    }
`
      try {
        const script = setup.replaceAll('/etc/apt', apt).replaceAll('/tmp/playwright-apt', archives)
        const result = Bun.spawnSync(['bash', '-c', privilege + script], {
          env: {
            ...process.env,
            PLAYWRIGHT: playwright,
            BROWSERS: 'chromium',
            ImageOS: 'ubuntu24',
            ImageVersion: 'fixture',
            RUNNER_ARCH: 'X64',
            GITHUB_OUTPUT: output,
          },
          timeout: 5_000,
        })
        expect(result.exitCode, result.stderr.toString()).toBe(0)
        expect(readFileSync(path.join(apt, 'apt-mirrors.txt'), 'utf8')).toBe(
          'https://archive.ubuntu.com/ubuntu/\tpriority:2\n' +
            'https://security.ubuntu.com/ubuntu/\tpriority:3\n',
        )
        expect(readFileSync(output, 'utf8')).toMatch(
          /^key=browser-apt-v3-ubuntu24-fixture-X64-1\.63\.0-/,
        )
        expect(readFileSync(path.join(apt, 'apt.conf.d/99-playwright-cache'), 'utf8')).toContain(
          `Dir::Cache::archives "${archives}";`,
        )
        if (cached) {
          expect(readFileSync(path.join(archives, 'dependency.deb'), 'utf8')).toBe(
            'cached dependency',
          )
        }
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
}
