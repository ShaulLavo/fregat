import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { buildPromoterSource } from '../../deploy/promoter-source'
import { cleanup, freePort, scratch } from './fixtures'

afterEach(cleanup)

test('a moved compiled launcher seeds its payload and sets up an injected machine service', async () => {
  const root = scratch()
  const checkout = path.resolve(import.meta.dirname, '../../..')
  const entry = path.join(root, 'entry.ts')
  const binary = path.join(root, 'Moved App', 'Fregat.app', 'Contents', 'MacOS', 'fregat')
  mkdirSync(path.dirname(binary), { recursive: true })
  const source = `
    import { mkdirSync } from 'node:fs'
    import path from 'node:path'
    import { ensureInstalledService } from ${JSON.stringify(path.join(checkout, 'apps/desktop/src/launcher/installation-client.ts'))}
    import { ensureMachineService } from ${JSON.stringify(path.join(checkout, 'scripts/service/ensure-machine-service.ts'))}
    import { appBundle } from ${JSON.stringify(path.join(checkout, 'apps/desktop/src/launcher/bundle.ts'))}
    import { recordingHost, fregatServer } from ${JSON.stringify(path.join(checkout, 'scripts/service/tests/fixtures.ts'))}
    const intent = JSON.parse(process.argv[2])
    const releaseRoot = process.argv[3]
    const testRoot = process.argv[4]
    mkdirSync(intent.stateHome, { recursive: true })
    const { host, commands } = recordingHost(testRoot, 'darwin', (argv) => {
      if (argv[1] === 'print') return { code: 1 }
      if (argv[1] === 'bootstrap') fregatServer({ stateHome: intent.stateHome, port: Number(new URL(intent.address).port) })
    })
    host.bun = process.execPath
    const bundle = appBundle()
    const result = await ensureInstalledService({
      intent, productionRoot: releaseRoot, bundledRelease: bundle.release,
      signal: new AbortController().signal,
      ensure: (requested, options) => ensureMachineService(requested, { ...options, host }),
    })
    const plist = host.readFile(path.join(host.home, 'Library/LaunchAgents/dev.fregat.server.plist'))
    console.log(JSON.stringify({ result, commands, plist, runtime: host.bun }))
    process.exit(0)
  `
  writeFileSync(entry, source)
  const built = await Bun.build({
    entrypoints: [entry],
    target: 'bun',
    compile: { outfile: binary },
  })
  expect(built.success, built.logs.map(String).join('\n')).toBe(true)
  renameSync(entry, `${entry}.hidden`)
  const payload = path.resolve(path.dirname(binary), '../Resources/release')
  for (const part of ['bin', 'server/node_modules', 'node_modules', 'web'])
    mkdirSync(path.join(payload, part), { recursive: true })
  writeFileSync(path.join(payload, 'bin/promote.js'), await buildPromoterSource())
  writeFileSync(path.join(payload, 'server/index.js'), '')
  writeFileSync(path.join(payload, 'web/index.html'), 'bundled')
  writeFileSync(
    path.join(payload, 'build-config.json'),
    JSON.stringify({ commit: 'a'.repeat(40), release: 'bundled' }),
  )
  const intent = {
    stateHome: path.join(root, 'state'),
    address: `http://127.0.0.1:${await freePort()}`,
    webBase: '/',
    expected: null,
  }
  const releaseRoot = path.join(root, 'Application Support', 'releases')
  const child = Bun.spawn([binary, JSON.stringify(intent), releaseRoot, root], {
    env: { ...process.env, BUN_BE_BUN: undefined },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect(code, stderr).toBe(0)
  const output = JSON.parse(stdout.trim())
  expect(output.result.disposition).toBe('registered')
  expect(output.runtime).toBe(binary)
  expect(output.plist).toContain('<key>BUN_BE_BUN</key><string>1</string>')
  expect(output.plist).toContain('bin/promote.js')
  expect(output.commands.map((argv: string[]) => argv[0])).toEqual(['launchctl', 'launchctl'])
  expect(readFileSync(path.join(releaseRoot, 'bin/promote.js'), 'utf8')).toBe(
    readFileSync(path.join(payload, 'bin/promote.js'), 'utf8'),
  )
  const promoter = Bun.spawn([binary, path.join(releaseRoot, 'bin/promote.js'), releaseRoot], {
    env: { ...process.env, BUN_BE_BUN: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [promotionOutput, promotionError, promotionCode] = await Promise.all([
    new Response(promoter.stdout).text(),
    new Response(promoter.stderr).text(),
    promoter.exited,
  ])
  expect(promotionCode, promotionError).toBe(0)
  expect(promotionOutput).toContain('[promote] promote: none')
}, 60_000)
