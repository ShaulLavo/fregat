import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  symlinkSync,
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { showFiles } from './show'

const fixture = test.extend<{ root: string }>({
  root: async ({ task }, provide) => {
    const root = mkdtempSync(path.join(tmpdir(), `show-test-${task.id}-`))
    try {
      await provide(root)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
})

fixture(
  'builds visual assets and HTML folders, publishes privately, then cleans up',
  ({ root }) => {
    const files = ['shot & photo.png', 'clip.webm', 'mock.html', 'report.md'].map((name) =>
      path.join(root, name),
    )
    for (const file of files) writeFileSync(file, 'fixture')
    const mock = path.join(root, 'interactive')
    mkdirSync(mock)
    writeFileSync(path.join(mock, 'index.html'), '<img src="image.png">')
    writeFileSync(path.join(mock, 'image.png'), 'nested fixture')
    files.push(mock)
    let uploaded = ''
    const result = showFiles(files, {
      run: (args) => {
        expect(args.slice(0, 3)).toEqual(['app', 'create', hostname()])
        expect(args[4]).toBe('--json')
        uploaded = args[3]!
        const html = readFileSync(path.join(uploaded, 'index.html'), 'utf8')
        expect(html).toContain('shot &amp; photo.png')
        expect(html).toContain('href="3-report.md"')
        expect(html).toContain('src="0-shot%20%26%20photo.png"')
        expect(html).toContain('<video src="1-clip.webm" controls>')
        expect(html).toContain('href="4-interactive/index.html"')
        expect(readFileSync(path.join(uploaded, '2-mock.html'), 'utf8')).toBe('fixture')
        expect(readFileSync(path.join(uploaded, '4-interactive/image.png'), 'utf8')).toBe(
          'nested fixture',
        )
        return {
          exitCode: 0,
          stderr: '',
          stdout: JSON.stringify({
            url: 'https://show.example',
            app: { visibility: 'private', expiresAt: '2030-01-01T00:00:00Z' },
          }),
        }
      },
    })
    expect(result).toEqual({ url: 'https://show.example', expiresAt: '2030-01-01T00:00:00Z' })
    expect(existsSync(uploaded)).toBe(false)
  },
)

fixture('publishes a single HTML folder directly with its relative assets', ({ root }) => {
  const folder = path.join(root, 'mock')
  mkdirSync(folder)
  writeFileSync(path.join(folder, 'index.html'), '<img src="image.png">')
  writeFileSync(path.join(folder, 'image.png'), 'nested fixture')
  showFiles([folder], {
    run: (args) => {
      expect(readFileSync(path.join(args[3]!, 'index.html'), 'utf8')).toBe('<img src="image.png">')
      expect(readFileSync(path.join(args[3]!, 'image.png'), 'utf8')).toBe('nested fixture')
      return {
        exitCode: 0,
        stderr: '',
        stdout: JSON.stringify({
          url: 'https://show.example',
          app: { visibility: 'private', expiresAt: '2030-01-01T00:00:00Z' },
        }),
      }
    },
  })
})

fixture('reports missing files and mesh failures with stderr', ({ root }) => {
  expect(() => showFiles([])).toThrow('Choose files')
  expect(() => showFiles([path.join(root, 'missing.png')])).toThrow('missing or unavailable')
  const image = path.join(root, 'image.png')
  writeFileSync(image, 'fixture')
  let uploaded = ''
  try {
    showFiles([image], {
      host: 'fixture-host',
      run: (args) => {
        expect(args[2]).toBe('fixture-host')
        uploaded = args[3]!
        return { exitCode: 1, stdout: '', stderr: 'mesh diagnostic' }
      },
    })
    expect.unreachable()
  } catch (error) {
    expect(error).toMatchObject({ internal: { stderr: 'mesh diagnostic', exitCode: 1 } })
  }
  expect(existsSync(uploaded)).toBe(false)
  for (const stdout of [
    'invalid json',
    '{}',
    JSON.stringify({
      url: 'https://show.example',
      app: { visibility: 'public', expiresAt: '2030-01-01T00:00:00Z' },
    }),
  ]) {
    expect(() => showFiles([image], { run: () => ({ exitCode: 0, stdout, stderr: '' }) })).toThrow(
      'could not publish',
    )
  }
})

fixture('rejects links outside an HTML folder', ({ root }) => {
  const folder = path.join(root, 'mock')
  mkdirSync(folder)
  writeFileSync(path.join(folder, 'index.html'), '<p>Mock</p>')
  const outside = path.join(root, 'outside.txt')
  writeFileSync(outside, 'private fixture')
  symlinkSync(outside, path.join(folder, 'linked.txt'))
  expect(() =>
    showFiles([folder], {
      run: () => {
        expect.unreachable()
      },
    }),
  ).toThrow('regular files')
})

fixture('CLI explains when mesh is missing without accessing the network', ({ root }) => {
  const image = path.join(root, 'image.png')
  writeFileSync(image, 'fixture')
  const result = Bun.spawnSync(
    [process.execPath, path.join(import.meta.dirname, 'show.ts'), image],
    {
      env: { ...process.env, PATH: '' },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  expect(result.exitCode).toBe(1)
  expect(result.stdout.toString()).toBe('')
  expect(result.stderr.toString()).toContain('Mesh is required')
  expect(result.stderr.toString()).toContain('Fix: Install mesh')
})
