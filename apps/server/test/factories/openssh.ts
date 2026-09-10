import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir, userInfo } from 'node:os'
import path from 'node:path'

import { reserveForwardPort } from '../../src/machines/forward'
import { shellQuote } from '../../src/utils/shell'

export const sshPassphrase = 'temporary OpenSSH fixture passphrase'

export async function localOpenSsh(passwordOnly = false, remotePath?: string) {
  const directory = await mkdtemp(path.join(tmpdir(), 'platform-openssh-'))
  const port = await reserveForwardPort()
  const privateBin = path.join(directory, 'bin')
  const clientKey = path.join(directory, 'client-key')
  const hostKey = path.join(directory, 'host-key')
  const config = path.join(directory, 'config')
  const daemonConfig = path.join(directory, 'sshd-config')
  const daemonLog = path.join(directory, 'sshd.log')
  const ssh = Bun.which('ssh')
  const sshd = Bun.which('sshd')
  assert.ok(ssh && sshd, 'OpenSSH client and server are required for this fixture')
  await mkdir(privateBin)
  await generateKey(clientKey, sshPassphrase)
  await generateKey(hostKey, '')
  await writeFile(
    config,
    `Host fixture\n  HostName 127.0.0.1\n  User ${userInfo().username}\n  Port ${port}\n  IdentityFile ${clientKey}\n  IdentitiesOnly yes\n  UserKnownHostsFile ${directory}/known-hosts\n  GlobalKnownHostsFile /dev/null\n`,
  )
  await writeFile(
    path.join(privateBin, 'ssh'),
    `#!/bin/sh\nexec ${shellQuote(ssh)} -F ${shellQuote(config)} "$@"\n`,
    { mode: 0o700 },
  )
  await writeFile(
    daemonConfig,
    `Port ${port}\nListenAddress 127.0.0.1\nHostKey ${hostKey}\nPidFile ${directory}/pid\nAuthorizedKeysFile ${clientKey}.pub\nStrictModes no\nUsePAM no\nPasswordAuthentication ${passwordOnly ? 'yes' : 'no'}\nPubkeyAuthentication ${passwordOnly ? 'no' : 'yes'}\nLogLevel VERBOSE\n${remotePath ? `SetEnv PATH=${remotePath}\n` : ''}`,
  )
  const daemon = Bun.spawn([sshd, '-D', '-e', '-f', daemonConfig], {
    stdout: 'ignore',
    stderr: Bun.file(daemonLog),
  })
  async function close() {
    daemon.kill('SIGTERM')
    await daemon.exited
    await rm(directory, { recursive: true, force: true })
  }
  try {
    await waitUntil(async () => {
      assert.equal(daemon.exitCode, null, await readFile(daemonLog, 'utf8'))
      return Bun.file(path.join(directory, 'pid')).exists()
    })
  } catch (error) {
    await close()
    throw error
  }
  return {
    port,
    close,
    readLog: () => readFile(daemonLog, 'utf8'),
    environment: { ...process.env, PATH: `${privateBin}:${process.env.PATH}` },
  }
}

export async function waitUntil(condition: () => Promise<boolean>) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (await condition()) return
    await Bun.sleep(20)
  }
  assert.fail('OpenSSH fixture did not reach the expected state within 5 seconds')
}

async function generateKey(filename: string, passphrase: string) {
  const child = Bun.spawn(['ssh-keygen', '-q', '-t', 'ed25519', '-N', passphrase, '-f', filename], {
    stdout: 'ignore',
    stderr: 'pipe',
  })
  assert.equal(await child.exited, 0, await new Response(child.stderr).text())
}
