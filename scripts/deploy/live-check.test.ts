import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { emptyWorkbenchUrl } from './live-terminal.mjs'

test.each(['/', '/demo/'])(
  'opens an explicit empty workspace without restored tabs under %s',
  (basePath) => {
    expect(emptyWorkbenchUrl(`https://example.com${basePath}`)).toBe(
      `https://example.com${basePath}~-/workbench?tabs=-`,
    )
  },
)

const script = path.join(import.meta.dirname, 'live-check.mjs')

test('a standalone live check requires an explicit target before browser or network work', () => {
  const result = Bun.spawnSync(['node', script])
  expect(result.exitCode).toBe(1)
  expect(result.stderr.toString()).toContain('Pass --target=')
})

test.each([
  'invalid',
  'file:///tmp/page',
  'https://user:secret@example.com/demo/',
  'https://example.com/demo/?query',
  'https://example.com/demo/#fragment',
])('a standalone live check rejects target %s before browser or network work', (target) => {
  const result = Bun.spawnSync(['node', script, `--target=${target}`])
  expect(result.exitCode).toBe(1)
  expect(result.stderr.toString()).toContain('The target must be an HTTP or HTTPS page URL')
})

test.each(['?', '#'])(
  'a standalone live check rejects an empty %s delimiter before effects',
  async (delimiter) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'deploy-empty-delimiter-'))
    const requests: string[] = []
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        requests.push(request.url)
        return Response.json({ server: { release: 'old' } })
      },
    })
    try {
      const child = Bun.spawn(
        [
          'node',
          script,
          `--target=http://127.0.0.1:${server.port}/demo/${delimiter}`,
          '--release=new',
          '--wait-for-server=1',
          `--out=${directory}`,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      )
      const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
      expect(code, stderr).toBe(1)
      expect(stderr, JSON.stringify(requests)).toContain(
        'The target must be an HTTP or HTTPS page URL',
      )
      expect(requests).toEqual([])
      expect(existsSync(path.join(directory, 'live-check.json'))).toBe(false)
    } finally {
      await server.stop(true)
      rmSync(directory, { recursive: true, force: true })
    }
  },
)

test.each(['/demo/', '/demo', '/', '/demo%3F%23/'])(
  'restart readiness polls the configured origin and route %s',
  async (route) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'deploy-live-target-'))
    const requests: string[] = []
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        requests.push(new URL(request.url).pathname)
        return Response.json({ server: { release: 'old' } })
      },
    })
    const target = `http://127.0.0.1:${server.port}${route}`
    const base = `${target.replace(/\/$/, '')}/`
    try {
      const process = Bun.spawn(
        [
          'node',
          script,
          `--target=${target}`,
          '--release=new',
          '--wait-for-server=1',
          `--out=${directory}`,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      )
      const [code, stderr] = await Promise.all([
        process.exited,
        new Response(process.stderr).text(),
      ])
      expect(code, stderr).toBe(1)
      expect(requests).toEqual([new URL(`${base}release`).pathname])
      expect(
        JSON.parse(readFileSync(path.join(directory, 'live-check.json'), 'utf8')),
      ).toMatchObject({
        target: base,
        status: 'failed',
        failures: ['server did not report new within 1ms'],
      })
    } finally {
      await server.stop(true)
      rmSync(directory, { recursive: true, force: true })
    }
  },
)
