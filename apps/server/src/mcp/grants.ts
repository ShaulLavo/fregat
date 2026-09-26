import { randomBytes } from 'node:crypto'

/** What one provider runtime may reach through Platform's MCP endpoint. */
export type McpGrant = {
  readonly sessionId: string
  readonly runtimeEpoch: string
  /** The checkout the runtime works in; tools answer about this one only. */
  readonly cwd: string
}

/**
 * Bearer tokens for provider runtimes, held in memory. A runtime's grant is replaced when its
 * epoch changes and dropped when it stops, so a token never outlives the process it was issued to.
 */
export class McpGrantRegistry {
  private readonly byToken = new Map<string, McpGrant>()
  private readonly tokenBySession = new Map<string, string>()

  /** The runtime's token: the one it already holds for this epoch and checkout, else a new one. */
  bind(grant: McpGrant): string {
    const token = this.tokenBySession.get(grant.sessionId)
    const held = token ? this.byToken.get(token) : null
    if (token && held?.runtimeEpoch === grant.runtimeEpoch && held.cwd === grant.cwd) return token
    return this.issue(grant)
  }

  issue(grant: McpGrant): string {
    this.revoke(grant.sessionId)
    const token = randomBytes(32).toString('base64url')
    this.byToken.set(token, grant)
    this.tokenBySession.set(grant.sessionId, token)
    return token
  }

  resolve(token: string): McpGrant | null {
    return this.byToken.get(token) ?? null
  }

  revoke(sessionId: string) {
    const token = this.tokenBySession.get(sessionId)
    if (!token) return
    this.byToken.delete(token)
    this.tokenBySession.delete(sessionId)
  }

  get size() {
    return this.byToken.size
  }
}
