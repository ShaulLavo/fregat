import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createInternalError } from '../../../observability/structured-errors'
import {
  CLIENT_REQUEST_UPSTREAM_PATH,
  CODEX_PROTOCOL_UPSTREAM_REF,
  CODEX_PROTOCOL_UPSTREAM_SOURCE,
  parseCodexProtocolMethodMaps,
  schemaFileUpstreamPath,
  schemaFilesForMethodMaps,
  SERVER_NOTIFICATION_UPSTREAM_PATH,
  UPSTREAM_DIR,
  upstreamRawUrl,
  writeCodexProtocolFiles,
} from './generate'

const USER_AGENT = 'platform-codex-protocol-vendor-update'
const MANIFEST_PATH = path.join(UPSTREAM_DIR, 'manifest.json')

/**
 * The only script in this feature that reaches the network. It downloads the pinned
 * (or newly given) Codex protocol ref into `upstream/`, records the ref in
 * `manifest.json`, and regenerates `generated/` from what it just vendored.
 */
async function main() {
  const ref = process.argv[2] ?? CODEX_PROTOCOL_UPSTREAM_REF
  const [clientRequestText, serverNotificationText] = await Promise.all([
    downloadText(upstreamRawUrl(ref, CLIENT_REQUEST_UPSTREAM_PATH)),
    downloadText(upstreamRawUrl(ref, SERVER_NOTIFICATION_UPSTREAM_PATH)),
  ])
  const methodMaps = parseCodexProtocolMethodMaps(clientRequestText, serverNotificationText)
  const schemaFiles = schemaFilesForMethodMaps(methodMaps)
  const schemaDownloads = await Promise.all(
    schemaFiles.map(async (file) => ({
      relativePath: schemaFileUpstreamPath(file),
      text: await downloadText(upstreamRawUrl(ref, schemaFileUpstreamPath(file))),
    })),
  )

  await writeUpstreamFile(CLIENT_REQUEST_UPSTREAM_PATH, clientRequestText)
  await writeUpstreamFile(SERVER_NOTIFICATION_UPSTREAM_PATH, serverNotificationText)
  for (const { relativePath, text } of schemaDownloads) await writeUpstreamFile(relativePath, text)
  await writeManifest(ref)

  await writeCodexProtocolFiles({ check: false })
  console.log(
    `Vendored Codex protocol inputs at ${ref} (${schemaDownloads.length + 2} files) and regenerated schema.gen.ts/meta.gen.ts.`,
  )
}

async function downloadText(url: string) {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw createInternalError(`Failed to download ${url}: ${response.status} ${detail}`)
  }

  return response.text()
}

async function writeUpstreamFile(relativePath: string, text: string) {
  const filePath = path.join(UPSTREAM_DIR, relativePath)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, text)
}

async function writeManifest(ref: string) {
  const manifest = {
    source: CODEX_PROTOCOL_UPSTREAM_SOURCE,
    ref,
    fetchedAt: new Date().toISOString(),
  }
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)
}

if (import.meta.main) await main()
