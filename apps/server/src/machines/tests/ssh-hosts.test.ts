import { mkdir, symlink } from 'node:fs/promises'
import path from 'node:path'
import { expect } from 'vitest'
import { test, writeConfig } from '../../../test/factories/ssh-config'
import { discoverSshHosts } from '../ssh-hosts'
import { isSelectableSshHost, parseSshConfig } from '../utils/ssh-config'

test('parses explicit aliases with SSH quoting, case, comments and equals syntax', () => {
  const directives = parseSshConfig(`
    # Host ignored-comment
    hOsT = Dev_Box "dev.example" '*.internal' !excluded -invalid [::1] host? local
    Hostname ignored-hostname
    Host 'another' # Host ignored-comment
    Include "config.d/work hosts" config.d/home\\ hosts
  `)
  expect(directives).toEqual([
    {
      kind: 'host',
      values: [
        'Dev_Box',
        'dev.example',
        '*.internal',
        '!excluded',
        '-invalid',
        '[::1]',
        'host?',
        'local',
      ],
    },
    { kind: 'host', values: ['another'] },
    { kind: 'include', values: ['config.d/work hosts', 'config.d/home hosts'] },
  ])
  expect(directives[0]?.values.filter(isSelectableSshHost)).toEqual([
    'Dev_Box',
    'dev.example',
    'local',
  ])
})

test.each(['Host', 'Include # no path', 'Host "unclosed', 'Include "unclosed'])(
  'reports malformed discovery directive %s',
  (contents) => {
    expect(() => parseSshConfig(contents)).toThrow(
      expect.objectContaining({ code: 'machines.SSH_DISCOVERY' }),
    )
  },
)

test('returns no aliases when both SSH configurations are absent', async ({ sshDirectories }) => {
  expect(await discoverSshHosts(sshDirectories)).toEqual([])
})

test('collects user and system aliases and resolves includes from each SSH directory', async ({
  sshDirectories,
}) => {
  const userConfig = path.join(sshDirectories.homeDirectory, '.ssh')
  await writeConfig(
    path.join(userConfig, 'config'),
    'Include config.d/* missing-file\nHost shared zulu',
  )
  await writeConfig(path.join(userConfig, 'config.d/main'), 'Include extra\nHost Bravo shared')
  await writeConfig(path.join(userConfig, 'extra'), 'Host nested')
  await writeConfig(
    path.join(sshDirectories.systemDirectory, 'ssh_config'),
    'Include ssh_config.d/*\nHost alpha shared',
  )
  await writeConfig(
    path.join(sshDirectories.systemDirectory, 'ssh_config.d/main'),
    'Host system-host',
  )
  expect(await discoverSshHosts(sshDirectories)).toEqual([
    'Bravo',
    'alpha',
    'nested',
    'shared',
    'system-host',
    'zulu',
  ])
})

test('follows quoted, home and absolute includes and stops cycles through symlinks', async ({
  sshDirectories,
}) => {
  const userConfig = path.join(sshDirectories.homeDirectory, '.ssh')
  await writeConfig(
    path.join(userConfig, 'config'),
    `Include "~/config with space" \${HOME}/config-home %d/config-token "${userConfig}/absolute"\nHost main`,
  )
  await writeConfig(
    path.join(sshDirectories.homeDirectory, 'config with space'),
    'Include again\nHost quoted',
  )
  await writeConfig(path.join(sshDirectories.homeDirectory, 'config-home'), 'Host environment')
  await writeConfig(path.join(sshDirectories.homeDirectory, 'config-token'), 'Host token')
  await writeConfig(path.join(userConfig, 'absolute'), 'Host absolute')
  await symlink(path.join(userConfig, 'config'), path.join(userConfig, 'again'))
  expect(await discoverSshHosts(sshDirectories)).toEqual([
    'absolute',
    'environment',
    'main',
    'quoted',
    'token',
  ])
})

test('enumerates static includes without evaluating Match exec or target-dependent paths', async ({
  sshDirectories,
}) => {
  const userConfig = path.join(sshDirectories.homeDirectory, '.ssh')
  const marker = path.join(sshDirectories.homeDirectory, 'executed')
  await writeConfig(
    path.join(userConfig, 'config'),
    `Match exec "touch ${marker}"\nInclude conditional config-%h\nHost laptop\nProxyCommand touch ${marker}`,
  )
  await writeConfig(path.join(userConfig, 'conditional'), 'Host conditional-host')
  expect(await discoverSshHosts(sshDirectories)).toEqual(['conditional-host', 'laptop'])
  expect(await Bun.file(marker).exists()).toBe(false)
})

test('distinguishes unreadable configuration paths from absent configurations', async ({
  sshDirectories,
}) => {
  await mkdir(path.join(sshDirectories.homeDirectory, '.ssh/config'))
  await expect(discoverSshHosts(sshDirectories)).rejects.toMatchObject({
    code: 'machines.SSH_DISCOVERY',
  })
})

test('bounds acyclic include recursion', async ({ sshDirectories }) => {
  const userConfig = path.join(sshDirectories.homeDirectory, '.ssh')
  await writeConfig(path.join(userConfig, 'config'), 'Include part-0')
  for (let index = 0; index < 34; index++)
    await writeConfig(
      path.join(userConfig, `part-${index}`),
      `Include part-${index + 1}\nHost host-${index}`,
    )
  await expect(discoverSshHosts(sshDirectories)).rejects.toMatchObject({
    code: 'machines.SSH_DISCOVERY',
  })
})
