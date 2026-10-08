import { execFile } from 'node:child_process'
import { isIP } from 'node:net'
import { promisify } from 'node:util'
import * as v from 'valibot'

import { recordRequestContext } from '../observability'

/** What Tailscale says about one node: its user's login, and whether it is tagged or shared in. */
export type TailnetNode = {
  readonly login: string
  readonly tagged: boolean
  readonly shared: boolean
}

/** A lookup that could not answer, and why, for the log. */
export type TailnetFailure = { readonly failure: string }

/**
 * The Tailscale calls this machine makes: the node holding an address, and this machine's own
 * tailnet address. Tests inject both, so they run where Tailscale is absent.
 */
export type TailnetLookup = {
  readonly whois: (address: string) => Promise<TailnetNode | TailnetFailure>
  readonly selfAddress: () => Promise<string | TailnetFailure>
}

/** Why a device is or is not this machine's owner; logged with every decision. */
export type TailnetVerdict =
  | 'same-user'
  | 'other-user'
  | 'tagged'
  | 'shared'
  | 'this-machine-tagged'
  | 'not-tailnet'
  | 'unavailable'
  | 'off'

type Entry = { readonly verdict: TailnetVerdict; readonly at: number }

/** A device that leaves the tailnet or changes user is out within this long. */
const VERDICT_TTL_MS = 60_000
/** A Tailscale that could not answer is asked again sooner: it may be starting. */
const UNAVAILABLE_TTL_MS = 5_000
/** Bounds the cache when many addresses arrive at once; the oldest answers go first. */
const MAX_ENTRIES = 256

const whoisSchema = v.object({
  Node: v.object({
    Tags: v.optional(v.nullable(v.array(v.string())), null),
    Sharer: v.optional(v.nullable(v.unknown()), null),
  }),
  UserProfile: v.object({ LoginName: v.pipe(v.string(), v.minLength(1)) }),
})

const statusSchema = v.object({
  BackendState: v.literal('Running'),
  Self: v.object({ TailscaleIPs: v.pipe(v.array(v.string()), v.minLength(1)) }),
})

/**
 * Whether a forwarded client is one of this machine owner's own Tailscale devices: an untagged
 * node, not shared in from another tailnet, signed in as the user this machine is signed in as.
 * Lookups are async and requests are admitted synchronously, so `resolve` runs at the start of
 * every request and `verdict` reads what it settled. Any Tailscale failure answers `unavailable`,
 * which pairs: it fails closed.
 */
export class TailnetOwners {
  private readonly lookup: TailnetLookup
  private readonly enabled: () => boolean
  private readonly now: () => number
  private readonly verdicts = new Map<string, Entry>()
  private readonly pending = new Map<string, Promise<TailnetVerdict>>()

  constructor(options: {
    readonly lookup: TailnetLookup
    readonly enabled: () => boolean
    readonly now?: () => number
  }) {
    this.lookup = options.lookup
    this.enabled = options.enabled
    this.now = options.now ?? Date.now
  }

  /** The settled answer for `address`, or `unavailable` when none is fresh. */
  verdict(address: string): TailnetVerdict {
    if (!this.isEnabled()) return 'off'
    if (!isTailnetAddress(address)) return 'not-tailnet'
    const entry = this.verdicts.get(address)
    return entry && this.fresh(entry) ? entry.verdict : 'unavailable'
  }

  /** Settles the answer for `address`, asking Tailscale at most once a minute per address. */
  async resolve(address: string): Promise<void> {
    if (!this.isEnabled() || !isTailnetAddress(address)) return
    const entry = this.verdicts.get(address)
    if (entry && this.fresh(entry)) return
    const inflight = this.pending.get(address)
    if (inflight) {
      await inflight
      return
    }
    const asking = this.ask(address).catch((): TailnetVerdict => 'unavailable')
    this.pending.set(address, asking)
    try {
      this.remember(address, await asking)
    } finally {
      this.pending.delete(address)
    }
  }

  private async ask(address: string): Promise<TailnetVerdict> {
    const startedAt = performance.now()
    const [client, self] = await Promise.all([this.lookup.whois(address), this.ownNode()])
    const outcome = judge(client, self)
    recordRequestContext({
      tailnetOwner: {
        verdict: outcome.verdict,
        durationMs: Math.round(performance.now() - startedAt),
        ...(outcome.failure ? { failure: outcome.failure } : {}),
      },
    })
    return outcome.verdict
  }

  private async ownNode(): Promise<TailnetNode | TailnetFailure> {
    const own = await this.lookup.selfAddress()
    return typeof own === 'string' ? this.lookup.whois(own) : own
  }

  private fresh(entry: Entry) {
    const ttl = entry.verdict === 'unavailable' ? UNAVAILABLE_TTL_MS : VERDICT_TTL_MS
    return this.now() - entry.at <= ttl
  }

  private remember(address: string, verdict: TailnetVerdict) {
    this.verdicts.delete(address)
    this.verdicts.set(address, { verdict, at: this.now() })
    if (this.verdicts.size <= MAX_ENTRIES) return
    const oldest = this.verdicts.keys().next().value
    if (oldest !== undefined) this.verdicts.delete(oldest)
  }

  /** A settings store that cannot answer leaves this trust off: it fails closed. */
  private isEnabled() {
    try {
      return this.enabled()
    } catch {
      return false
    }
  }
}

function judge(
  client: TailnetNode | TailnetFailure,
  self: TailnetNode | TailnetFailure,
): { verdict: TailnetVerdict; failure?: string } {
  if ('failure' in self) return { verdict: 'unavailable', failure: `self: ${self.failure}` }
  if ('failure' in client) return { verdict: 'unavailable', failure: `client: ${client.failure}` }
  if (self.tagged) return { verdict: 'this-machine-tagged' }
  if (client.tagged) return { verdict: 'tagged' }
  if (client.shared) return { verdict: 'shared' }
  return { verdict: client.login === self.login ? 'same-user' : 'other-user' }
}

/** Tailscale's address ranges: 100.64.0.0/10 and fd7a:115c:a1e0::/48. Others never reach whois. */
function isTailnetAddress(address: string) {
  if (isIP(address) === 4) {
    const [first, second] = address.split('.').map(Number)
    return first === 100 && second !== undefined && second >= 64 && second <= 127
  }
  return isIP(address) === 6 && /^fd7a:115c:a1e0:/i.test(address)
}

const execFileAsync = promisify(execFile)

/** Asks the `tailscale` CLI on this machine; a missing, stopped or slow CLI is a failure. */
export const tailscaleCli: TailnetLookup = {
  async whois(address) {
    if (!isTailnetAddress(address)) return { failure: 'not-tailnet' }
    const output = await tailscale(['whois', '--json', address])
    if ('failure' in output) return output
    const parsed = v.safeParse(whoisSchema, output.json)
    if (!parsed.success) return { failure: 'invalid-whois' }
    const { Node, UserProfile } = parsed.output
    return {
      login: UserProfile.LoginName,
      tagged: (Node.Tags ?? []).length > 0,
      shared: Node.Sharer !== null && Node.Sharer !== 0,
    }
  },
  async selfAddress() {
    const output = await tailscale(['status', '--json', '--peers=false'])
    if ('failure' in output) return output
    const parsed = v.safeParse(statusSchema, output.json)
    if (!parsed.success) return { failure: 'not-running' }
    return parsed.output.Self.TailscaleIPs[0] ?? { failure: 'no-address' }
  },
}

async function tailscale(
  args: readonly string[],
): Promise<{ readonly json: unknown } | TailnetFailure> {
  try {
    const { stdout } = await execFileAsync('tailscale', args, {
      encoding: 'utf8',
      timeout: 2000,
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    })
    return { json: JSON.parse(stdout) as unknown }
  } catch (error) {
    return { failure: commandFailure(error) }
  }
}

function commandFailure(error: unknown) {
  if (error instanceof SyntaxError) return 'invalid-json'
  if (!(error instanceof Error)) return 'unknown'
  if ('code' in error && error.code === 'ENOENT') return 'not-installed'
  if ('killed' in error && error.killed) return 'timed-out'
  if ('code' in error) return `exit-${String(error.code)}`
  return 'unknown'
}

/** For tests and machines without Tailscale: every lookup fails, so every device pairs. */
export const noTailnet: TailnetLookup = {
  whois: () => Promise.resolve({ failure: 'no-tailnet' }),
  selfAddress: () => Promise.resolve({ failure: 'no-tailnet' }),
}
