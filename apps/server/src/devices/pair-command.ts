// Ships as `server/pair.js` in every release; `bun run pair` runs it from a checkout. It prints a
// pairing code from the server running on this machine, for when no paired browser is at hand.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { EvlogError } from 'evlog'
import * as v from 'valibot'
import {
  errorMessage,
  pairingLinkSchema,
  SETTINGS_REGISTRY,
  type PairingLink,
} from '@workspace/contracts'

import { platformHomePath } from '../home'
import { parseSettingsDocument } from '../settings/json-document'
import { pairingErrors } from './structured-errors'

const ADDRESS_FLAG = '--address='

/**
 * The machine service's loopback origin: `--address=<origin>`, else the state home's
 * `server.address`. Loopback means the server admits the request as this machine.
 */
export function pairServerAddress(argv: readonly string[], stateHome = platformHomePath()) {
  const flag = argv.find((argument) => argument.startsWith(ADDRESS_FLAG))
  if (flag) return flag.slice(ADDRESS_FLAG.length).replace(/\/$/, '')
  const setting = SETTINGS_REGISTRY['server.address']
  const file = path.join(stateHome, 'settings.json')
  if (!existsSync(file)) return setting.default
  const stored = parseSettingsDocument(readFileSync(file, 'utf8')).values['server.address']
  const parsed = v.safeParse(setting.schema, stored)
  return parsed.success ? parsed.output : setting.default
}

/** Asks the server at `address` for a code. Its own origin passes the server's origin check. */
export async function requestPairingCode(
  address: string,
  fetcher: (url: string, init: RequestInit) => Promise<Response> = fetch,
) {
  let response: Response
  try {
    response = await fetcher(`${address}/pairing/links`, {
      method: 'POST',
      headers: { origin: address },
    })
  } catch (error) {
    throw pairingErrors.SERVER_UNREACHABLE({ address, internal: { cause: errorMessage(error) } })
  }
  const body: unknown = await response.json().catch(() => null)
  const link = v.safeParse(pairingLinkSchema, body)
  if (!response.ok || !link.success)
    throw pairingErrors.SERVER_REFUSED({ address, internal: { status: response.status } })
  return link.output
}

/** The code in groups of four, as the pairing screen's field shows it. */
function spacedPairingCode(code: string) {
  return code.match(/.{1,4}/g)?.join(' ') ?? code
}

export function pairingCodeText(link: PairingLink) {
  const until = new Date(link.expiresAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
  return [
    `Pairing code: ${spacedPairingCode(link.code)}`,
    link.url ? `Link: ${link.url}` : null,
    `Type the code on the new device, or open the link there. It works once, until ${until}.`,
  ]
    .filter(Boolean)
    .join('\n')
}

async function main() {
  try {
    console.log(pairingCodeText(await requestPairingCode(pairServerAddress(process.argv))))
  } catch (error) {
    console.error(failureText(error))
    process.exit(1)
  }
}

function failureText(error: unknown) {
  if (!(error instanceof EvlogError)) return errorMessage(error)
  const lines = [error.message]
  if (error.why) lines.push(`Why: ${error.why}`)
  if (error.fix) lines.push(`Fix: ${error.fix}`)
  return lines.join('\n')
}

if (import.meta.main) await main()
