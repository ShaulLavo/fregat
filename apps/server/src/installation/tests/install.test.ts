import { readdir, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { expect } from 'vitest'
import { test } from '../../../test/factories/installation'
import { installServerLauncher } from '../install'
import { parseInstallation } from '../../machines/records'
import { probeCommand, stopCommand } from '../../machines/remote-scripts'

test('installation is repeatable and discoverable with neither Bun nor the launcher on PATH', async ({
  installationRoot,
  homeDirectory,
}) => {
  const installation = {
    kind: 'source',
    directory: installationRoot,
    executable: process.execPath,
  } as const
  const options = { homeDirectory, installation }
  const launcher = await installServerLauncher(options)
  const original = await readFile(launcher, 'utf8')
  expect(await installServerLauncher(options)).toBe(launcher)
  expect(await readFile(launcher, 'utf8')).toBe(original)
  expect((await stat(launcher)).mode & 0o777).toBe(0o700)
  expect(await readdir(path.dirname(launcher))).toEqual(['platform-server'])

  const probe = Bun.spawn(['/bin/sh', '-c', probeCommand()], {
    env: { HOME: homeDirectory, PATH: '/usr/bin:/bin' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const output = await new Response(probe.stdout).text()
  expect(await probe.exited, await new Response(probe.stderr).text()).toBe(0)
  expect(parseInstallation(output)).toEqual(installation)
  expect(await Bun.file(path.join(homeDirectory, 'unwanted')).exists()).toBe(false)

  const stop = Bun.spawn(
    [
      '/bin/sh',
      '-c',
      stopCommand(
        { installation: parseInstallation(output), clientId: 'unused-install-test' },
        null,
      ),
    ],
    {
      env: { HOME: homeDirectory, PATH: '/usr/bin:/bin' },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  expect(await stop.exited, await new Response(stop.stderr).text()).toBe(0)
})

test('discovers a launcher exposed on PATH', async ({
  installationRoot,
  homeDirectory,
  remoteRoot,
}) => {
  const installation = {
    kind: 'source',
    directory: installationRoot,
    executable: process.execPath,
  } as const
  const launcher = await installServerLauncher({ homeDirectory, installation })
  const probe = Bun.spawn(['/bin/sh', '-c', probeCommand()], {
    env: { HOME: remoteRoot, PATH: `${path.dirname(launcher)}:/usr/bin:/bin` },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const output = await new Response(probe.stdout).text()
  expect(await probe.exited).toBe(0)
  expect(parseInstallation(output)).toEqual(installation)
})

test('missing installation gives the install command instead of requesting a repository', async ({
  homeDirectory,
}) => {
  const probe = Bun.spawn(['/bin/sh', '-c', probeCommand()], {
    env: { HOME: homeDirectory, PATH: '/usr/bin:/bin' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  expect(await probe.exited).toBe(127)
  expect(await new Response(probe.stderr).text()).toContain('bun run server:install')
  expect(await new Response(probe.stdout).text()).toBe('')
})

test('a removed installation fails discovery before launch', async ({
  installationRoot,
  homeDirectory,
}) => {
  await installServerLauncher({
    homeDirectory,
    installation: { kind: 'source', directory: installationRoot, executable: process.execPath },
  })
  await rm(installationRoot, { recursive: true })
  const probe = Bun.spawn(['/bin/sh', '-c', probeCommand()], {
    env: { HOME: homeDirectory, PATH: '/usr/bin:/bin' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  expect(await probe.exited).toBe(1)
  expect(await new Response(probe.stderr).text()).toContain('installation is unavailable')
})

test.each(['not json', '{}', '{"kind":"source","directory":"relative","executable":"/bin/bun"}'])(
  'refuses an invalid installation descriptor: %s',
  (output) => {
    expect(() => parseInstallation(output)).toThrow('invalid installation descriptor')
  },
)
