/**
 * `bun run pair`: a one-time link that pairs a device with the production server, for when no
 * browser on this machine is at hand (over SSH, say). Made over loopback, which only this machine
 * reaches; the link works once, for 5 minutes, and is printed here and nowhere else.
 */
import { meshOrigin, meshUrl, serverPort } from './deploy/config'
import { createScriptError } from './structured-errors'

const response = await fetch(`http://127.0.0.1:${serverPort}/pairing/links`, {
  method: 'POST',
  headers: { origin: meshOrigin },
})
if (!response.ok)
  throw createScriptError(
    `The production server refused a pairing link (HTTP ${response.status}). Is platform-prod.service running on port ${serverPort}?`,
  )
const { code, expiresAt } = (await response.json()) as { code: string; expiresAt: string }
console.log(`${meshUrl}pair#token=${code}`)
console.log(`Works once, until ${new Date(expiresAt).toLocaleTimeString()}.`)
