import { open, rm, writeFile } from 'node:fs/promises'
import { expect, vi } from 'vitest'
import { test } from '../../../test/factories/ssh'
import { openSshDiagnostics } from '../../../test/factories/openssh-diagnostics'
import {
  authenticationFixture,
  readChild,
  runAskpass,
} from '../../../test/factories/authentication'

test('keeps capture silent and publishes only fixture SSH, agent and askpass evidence', async ({
  remoteRoot,
}) => {
  const secret = 'fixture-secret-answer-key-token'
  const diagnostics = openSshDiagnostics(remoteRoot, {
    SSH_AUTH_SOCK: `/private/${secret}`,
    SSH_AGENT_PID: secret,
  })
  const consoleError = vi.spyOn(console, 'error')
  try {
    await writeFile(
      diagnostics.tracePath,
      [
        `debug1: auto-mux: Trying existing master at /private/${secret}`,
        `debug1: Offering public key: ${secret}`,
        `debug1: Authenticated to private-host (${secret}) using "publickey".`,
        'debug1: mux_client_request_session: master session id: 3',
        '-----BEGIN OPENSSH PRIVATE KEY-----',
        secret,
        `Enter passphrase for key '/private/${secret}':`,
      ].join('\n'),
    )
    const authentication = await authenticationFixture(({ kind }) =>
      diagnostics.answer(kind, async () => secret),
    )
    expect((await readChild(runAskpass(authentication, secret, true))).exitCode).toBe(0)
    expect((await readChild(runAskpass(authentication, secret))).exitCode).toBe(0)
    expect(consoleError).not.toHaveBeenCalled()
    const output: string[] = []
    await diagnostics.publish((line) => output.push(line))
    expect(output).toHaveLength(1)
    expect(output[0]).not.toContain(secret)
    expect(output[0]).not.toContain('/private/')
    expect(output[0]).not.toContain('PRIVATE KEY')
    const report = JSON.parse(output[0]!.slice('OpenSSH fixture diagnostics '.length))
    expect(report.sshVerbose).toEqual([
      'auto-mux: Trying existing master',
      'Offering public key',
      'Authenticated using publickey',
      'mux_client_request_session status=3',
    ])
    expect(report.agent).toEqual({
      inheritedSocketPresent: true,
      inheritedPidPresent: true,
      fixtureSocketPresent: false,
      fixturePidPresent: false,
      identityAgent: 'none',
    })
    expect(report.askpass).toEqual([
      {
        order: 1,
        kind: 'confirmation',
        startedAt: expect.any(Number),
        finishedAt: expect.any(Number),
        status: 'answered',
      },
      {
        order: 2,
        kind: 'secret',
        startedAt: expect.any(Number),
        finishedAt: expect.any(Number),
        status: 'answered',
      },
    ])
    await authentication.close()
    await rm(remoteRoot, { recursive: true, force: true })
    expect(await Bun.file(diagnostics.tracePath).exists()).toBe(false)
  } finally {
    consoleError.mockRestore()
  }
})

test('records pending, cancelled and failed askpass requests without their payloads', async ({
  remoteRoot,
}) => {
  const diagnostics = openSshDiagnostics(remoteRoot)
  let complete!: (value: string | null) => void
  const pending = diagnostics.answer(
    'secret',
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  )
  const output: string[] = []
  await diagnostics.publish((line) => output.push(line))
  expect(
    JSON.parse(output[0]!.slice('OpenSSH fixture diagnostics '.length)).askpass[0].status,
  ).toBe('pending')
  complete(null)
  await pending
  await expect(
    diagnostics.answer('secret', async () => {
      throw new TypeError('fixture private payload')
    }),
  ).rejects.toThrow(TypeError)
  await diagnostics.publish((line) => output.push(line))
  const report = JSON.parse(output[1]!.slice('OpenSSH fixture diagnostics '.length))
  expect(report.askpass.map((entry: { status: string }) => entry.status)).toEqual([
    'cancelled',
    'failed',
  ])
  expect(output[1]).not.toContain('fixture private payload')
})

test('bounds trace tails and askpass history while preserving invocation counts', async ({
  remoteRoot,
}) => {
  const diagnostics = openSshDiagnostics(remoteRoot)
  await writeFile(
    diagnostics.tracePath,
    `${'private discarded content'.repeat(4000)}\n${'debug1: multiplexing control connection\n'.repeat(200)}`,
  )
  for (let index = 0; index < 40; index++)
    await diagnostics.answer('secret', async () => 'private answer')
  const output: string[] = []
  await diagnostics.publish((line) => output.push(line))
  const report = JSON.parse(output[0]!.slice('OpenSSH fixture diagnostics '.length))
  expect(report.traceTailTruncated).toBe(true)
  expect(report.sshVerbose).toHaveLength(128)
  expect(report.askpass).toHaveLength(32)
  expect(report.askpassInvocations).toBe(40)
  expect(report.askpass[0].order).toBe(9)
  expect(output[0]).not.toContain('private')
})

test('reads a bounded snapshot while the fixture still holds its trace descriptor', async ({
  remoteRoot,
}) => {
  const diagnostics = openSshDiagnostics(remoteRoot)
  const writer = await open(diagnostics.tracePath, 'a')
  try {
    await writer.write('debug1: multiplexing control connection\n')
    const output: string[] = []
    await diagnostics.publish((line) => output.push(line))
    const report = JSON.parse(output[0]!.slice('OpenSSH fixture diagnostics '.length))
    expect(report.sshVerbose).toEqual(['multiplexing control connection'])
    await writer.write('debug1: ControlPersist timeout expired\n')
  } finally {
    await writer.close()
  }
})

test('publishes an absent trace without replacing the original failure or retaining files', async ({
  remoteRoot,
}) => {
  const diagnostics = openSshDiagnostics(remoteRoot)
  await rm(remoteRoot, { recursive: true, force: true })
  const output: string[] = []
  await diagnostics.publish((line) => output.push(line))
  const report = JSON.parse(output[0]!.slice('OpenSSH fixture diagnostics '.length))
  expect(report.sshVerbose).toEqual([])
  expect(report.askpass).toEqual([])
  expect(report.agent.identityAgent).toBe('none')
  expect(await Bun.file(diagnostics.tracePath).exists()).toBe(false)
})
