import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect } from 'vitest'
import type { run } from '../run'

export function writeReleasePayload(directory: string, base = '/') {
  const write = (name: string, content = '') => {
    const file = path.join(directory, name)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, content)
  }
  write(
    'web/index.html',
    `<head></head><script type="module" src="${base}assets/main.js"></script>`,
  )
  write('web/dev.html', `<head></head><script type="module" src="${base}assets/main.js"></script>`)
  write('web/assets/main.js', 'export const fixture = true')
  write('web/assets/bridge.wasm')
  write(
    'server/index.js',
    `import { readFileSync } from 'node:fs'; import path from 'node:path'
const web = process.env.WEB_ROOT; const name = path.basename(path.dirname(web));
Bun.serve({port:Number(process.env.PORT),hostname:'127.0.0.1',fetch(request){
const route = new URL(request.url).pathname;
if(route === '/release') return Response.json({release:name,server:{release:name}});
if(route === '/health') return new Response('',{status:401});
if(request.headers.get('sec-fetch-dest') === 'document') return new Response(readFileSync(path.join(web,'index.html')));
return new Response('fixture');}})`,
  )
  for (const file of [
    'remote-support.js',
    'pty-host.js',
    'watch-worker.ts',
    'image-worker.ts',
    'THIRD_PARTY_NOTICES.txt',
  ])
    write(`server/${file}`)
  write('server/runtime/package.json', '{"name":"fixture","private":true}')
  write('server/runtime/bun.lock', '{}')
  write(
    'build-config.json',
    JSON.stringify({
      commit: 'a'.repeat(40),
      branch: 'fixture',
      dirtyFiles: [],
      editorCommit: null,
      release: directory,
      source: directory,
      webBase: base,
      meshUrl: '',
      previousRelease: null,
      server: directory,
      reason: null,
      builtAt: new Date().toISOString(),
      liveCheck: false,
    }),
  )
}

export function compilerFixture(root: string): typeof run {
  mkdirSync(root, { recursive: true })
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(['git', ...args], { cwd: root })
    expect(result.exitCode, result.stderr.toString()).toBe(0)
  }
  git('init', '-qb', 'fixture')
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '--allow-empty',
    '-qm',
    'fixture',
  )
  copyFileSync(path.resolve(import.meta.dirname, '../../../bun.lock'), path.join(root, 'bun.lock'))
  return async (command, options) => {
    if (!command.includes('install'))
      expect(options?.cwd?.startsWith(root), 'compilers run in the selected fixture checkout').toBe(
        true,
      )
    if (command.includes('install'))
      expect(
        options?.cwd?.endsWith(path.join('server', 'runtime')),
        'dependencies install inside the release',
      ).toBe(true)
    if (command.includes('vite')) {
      const destination = command[command.indexOf('--outDir') + 1]!
      const base = command[command.indexOf('--base') + 1]!
      writeReleasePayload(path.dirname(destination), base)
    }
    if (command.includes('build') && options?.cwd === path.join(root, 'apps/server')) {
      writeReleasePayload(path.join(root, 'compiled'))
      mkdirSync(path.join(root, 'apps/server'), { recursive: true })
      const { cpSync } = await import('node:fs')
      cpSync(path.join(root, 'compiled/server'), path.join(root, 'apps/server/dist'), {
        recursive: true,
      })
    }
    if (command.includes('install')) {
      mkdirSync(path.join(options!.cwd!, 'node_modules'), { recursive: true })
      writeFileSync(path.join(options!.cwd!, 'node_modules', 'fixture.txt'), 'runtime dependency')
    }
    return { code: 0, stdout: '' }
  }
}
