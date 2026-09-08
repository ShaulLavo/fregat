import assert from 'node:assert/strict'
import { MockProviderAdapter } from 'server/testing'
import { createError } from 'evlog'
import type { ProviderAuth, ProviderLoginAttempt, ProviderSignInMethod } from '@workspace/contracts'

export class AccountProviderAdapter extends MockProviderAdapter {
  override readonly capabilities = {
    listCommands: true as const,
    sessionModelSwitch: 'in-session' as const,
    signIn: true,
  }
  private authenticated = false
  private attempt: ProviderLoginAttempt | null = null
  readonly cancellations: string[] = []
  cancelFails = false
  async authStatus(): Promise<ProviderAuth> {
    return { status: this.authenticated ? 'authenticated' : 'unauthenticated' }
  }
  override async snapshot() {
    return { ...(await super.snapshot()), auth: await this.authStatus() }
  }
  async signIn({ method }: { method: ProviderSignInMethod }) {
    this.attempt = {
      attemptId: crypto.randomUUID(),
      providerInstanceId: this.adapterKey,
      method,
      state: 'pending',
      startedAt: new Date().toISOString(),
      completedAt: null,
      outputTail: ['Continue in your browser'],
    }
    return this.attempt
  }
  async signInAttempt({ attemptId }: { attemptId: string }) {
    return this.attempt?.attemptId === attemptId ? this.attempt : null
  }
  async cancelSignIn({ attemptId }: { attemptId: string }) {
    if (this.cancelFails) throw createError({ message: 'Sign-in cancellation failed', status: 503 })
    this.cancellations.push(attemptId)
    if (this.attempt?.attemptId !== attemptId) return null
    this.attempt = { ...this.attempt, state: 'cancelled', completedAt: new Date().toISOString() }
    return this.attempt
  }
  completeSignIn() {
    assert(this.attempt?.state === 'pending')
    this.authenticated = true
    this.attempt = { ...this.attempt, state: 'succeeded', completedAt: new Date().toISOString() }
  }
  async signOut() {
    this.authenticated = false
  }
}
