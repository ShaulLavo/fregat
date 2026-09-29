import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from 'vitest'
import { syncCredentials } from './credentials'

test('mirrors access tokens privately, follows account switches, and removes a logged-out mirror', async () => {
  await mkdir(path.join(process.cwd(), '.scratch/claude-gpt'), { recursive: true })
  const scratch = await mkdtemp(path.join(process.cwd(), '.scratch/claude-gpt/credentials-'))
  const source = path.join(scratch, 'auth.json')
  const destination = path.join(scratch, 'proxy-auth')
  const claims = Buffer.from(
    JSON.stringify({
      exp: 2_000_000_000,
      'https://api.openai.com/auth': { chatgpt_plan_type: 'pro' },
    }),
  ).toString('base64url')
  const accessToken = `header.${claims}.signature`
  const auth = {
    auth_mode: 'chatgpt',
    tokens: { access_token: accessToken, account_id: 'first', refresh_token: 'owned-by-codex' },
  }
  try {
    await writeFile(source, JSON.stringify(auth))
    await syncCredentials([source], destination)
    const files = await readdir(destination)
    expect(files).toHaveLength(1)
    const target = path.join(destination, files[0] ?? '')
    const mirrored = await Bun.file(target).json()
    expect(mirrored).toMatchObject({
      access_token: accessToken,
      account_id: 'first',
      plan_type: 'pro',
    })
    expect(mirrored).not.toHaveProperty('refresh_token')
    expect((await stat(target)).mode & 0o777).toBe(0o600)
    expect(await Bun.file(source).json()).toEqual(auth)

    auth.tokens.account_id = 'second'
    await writeFile(source, JSON.stringify(auth))
    await syncCredentials([source], destination)
    expect((await Bun.file(target).json()).account_id).toBe('second')
    expect(await readdir(destination)).toEqual(files)

    await rm(source)
    await syncCredentials([source], destination)
    expect(await readdir(destination)).toEqual([])
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})
