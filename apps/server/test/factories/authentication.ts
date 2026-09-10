import { afterEach } from 'vitest'
import { createSshAuthentication } from '../../src/machines/authentication'
import type { SshChild } from '../../src/machines/forward'

type Authentication = Awaited<ReturnType<typeof createSshAuthentication>>
const authentications: Authentication[] = []

afterEach(async () => {
  await Promise.all(authentications.splice(0).map((authentication) => authentication.close()))
})

export async function authenticationFixture(
  request: Parameters<typeof createSshAuthentication>[0]['request'],
) {
  const authentication = await createSshAuthentication({ request })
  authentications.push(authentication)
  return authentication
}

export function runAskpass(authentication: Authentication, prompt: string, confirmation = false) {
  const mode = confirmation ? 'confirm' : ''
  return authentication.spawn([
    'sh',
    '-c',
    'SSH_ASKPASS_PROMPT="$1" exec "$SSH_ASKPASS" "$2"',
    'askpass-test',
    mode,
    prompt,
  ])
}

export async function readChild(child: SshChild) {
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}
