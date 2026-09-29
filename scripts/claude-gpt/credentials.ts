import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as v from 'valibot'

const authSchema = v.object({
  auth_mode: v.literal('chatgpt'),
  tokens: v.object({
    access_token: v.pipe(v.string(), v.nonEmpty()),
    account_id: v.pipe(v.string(), v.nonEmpty()),
  }),
})
const claimsSchema = v.object({
  exp: v.number(),
  'https://api.openai.com/auth': v.optional(
    v.object({ chatgpt_plan_type: v.optional(v.string()) }),
  ),
})

export async function syncCredentials(sources: readonly string[], destination: string) {
  await mkdir(destination, { recursive: true, mode: 0o700 })
  for (const source of sources) await syncCredential(source, destination)
}

async function syncCredential(source: string, destination: string) {
  const key = createHash('sha256').update(source).digest('hex').slice(0, 16)
  const target = path.join(destination, `codex-cli-${key}.json`)
  const sourceFile = Bun.file(source)
  if (!(await sourceFile.exists())) {
    await rm(target, { force: true })
    return
  }
  const auth = v.parse(authSchema, await sourceFile.json())
  const payload = auth.tokens.access_token.split('.')[1] ?? ''
  const claims = v.parse(
    claimsSchema,
    JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
  )
  // Codex retains refresh ownership; the proxy receives a current access token only.
  const content = JSON.stringify({
    type: 'codex',
    access_token: auth.tokens.access_token,
    account_id: auth.tokens.account_id,
    plan_type: claims['https://api.openai.com/auth']?.chatgpt_plan_type ?? 'free',
    expired: new Date(claims.exp * 1000).toISOString(),
  })
  const existing = Bun.file(target)
  if ((await existing.exists()) && (await existing.text()) === content) {
    await chmod(target, 0o600)
    return
  }
  const temporary = `${target}.${randomUUID()}.tmp`
  await writeFile(temporary, content, { mode: 0o600 })
  await rename(temporary, target)
}
