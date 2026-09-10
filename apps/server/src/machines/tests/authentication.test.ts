import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from 'vitest'
import {
  authenticationFixture,
  readChild,
  runAskpass,
} from '../../../test/factories/authentication'

test('routes password prompts from a real askpass process and keeps its answer off disk', async () => {
  const prompts: unknown[] = []
  const secret = "fixture secret ' $(id)"
  const authentication = await authenticationFixture(async (prompt) => {
    prompts.push(prompt)
    return secret
  })
  const probe = await readChild(authentication.spawn(['sh', '-c', 'printf %s "$SSH_ASKPASS"']))
  const directory = path.dirname(probe.stdout)
  expect((await stat(directory)).mode & 0o777).toBe(0o700)
  const result = await readChild(runAskpass(authentication, 'Password for fixture:'))
  expect(result).toEqual({ exitCode: 0, stdout: `${secret}\n`, stderr: '' })
  expect(prompts).toEqual([{ prompt: 'Password for fixture:', kind: 'secret' }])
  for (const file of await readdir(directory)) {
    const filename = path.join(directory, file)
    if (!(await stat(filename)).isFile()) continue
    expect(await readFile(filename, 'utf8')).not.toContain(secret)
  }
  await authentication.close()
  expect(await Bun.file(probe.stdout).exists()).toBe(false)
})

test('routes host confirmation prompts and enables interactive OpenSSH options', async () => {
  const prompts: unknown[] = []
  const authentication = await authenticationFixture(async (prompt) => {
    prompts.push(prompt)
    return 'yes'
  })
  const result = await readChild(runAskpass(authentication, 'Trust fixture host?', true))
  expect(result).toEqual({ exitCode: 0, stdout: 'yes\n', stderr: '' })
  expect(prompts).toEqual([{ prompt: 'Trust fixture host?', kind: 'confirmation' }])
  const options = await readChild(
    authentication.spawn([
      'ssh',
      '-G',
      '-F',
      '/dev/null',
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=yes',
      '--',
      'fixture.invalid',
    ]),
  )
  expect(options.exitCode).toBe(0)
  expect(options.stdout).toContain('batchmode no\n')
  expect(options.stdout).toContain('stricthostkeychecking ask\n')
  expect(options.stdout).toContain('controlmaster auto\n')
  expect(options.stdout).toContain('controlpersist 60\n')
  expect(options.stdout).toContain('serveraliveinterval 15\n')
})

test('rejects an unauthenticated helper and exits cancelled askpass without a secret', async () => {
  let requests = 0
  const authentication = await authenticationFixture(async () => {
    requests += 1
    return null
  })
  const unauthorized = await readChild(
    authentication.spawn([
      'sh',
      '-c',
      'PLATFORM_SSH_ASKPASS_TOKEN=invalid exec "$SSH_ASKPASS" "$1"',
      'askpass-test',
      'Password:',
    ]),
  )
  expect(unauthorized).toEqual({ exitCode: 1, stdout: '', stderr: '' })
  expect(requests).toBe(0)
  const cancelled = await readChild(runAskpass(authentication, 'Password:'))
  expect(cancelled).toEqual({ exitCode: 1, stdout: '', stderr: '' })
  expect(requests).toBe(1)
})

test('closing releases a helper that is waiting for authentication', async () => {
  let requested = false
  const authentication = await authenticationFixture(() => {
    requested = true
    return new Promise(() => {})
  })
  const child = runAskpass(authentication, 'Password:')
  await expect.poll(() => requested).toBe(true)
  await authentication.close()
  expect(await readChild(child)).toEqual({ exitCode: 1, stdout: '', stderr: '' })
  await authentication.close()
})
