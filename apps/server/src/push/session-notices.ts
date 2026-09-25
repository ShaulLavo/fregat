import { scopedSessionKey, type EnvironmentId, type SessionNotice } from '@workspace/contracts'
import {
  errorSummary,
  recordProcessInfo,
  recordProcessWarning,
  runDetached,
} from '../observability'
import type { ClientPresence } from '../orchestration/client-presence'
import type { OrchestrationEngine } from '../orchestration/engine'
import type { SettingsStore } from '../settings/store'
import type { PushService } from './service'
import { createSessionNoticeFeed, type FedNotice } from './session-notice-feed'
import type { SessionLink } from './session-link'

export type SessionNoticePushOptions = {
  readonly environmentId: EnvironmentId
  readonly engine: Pick<OrchestrationEngine, 'shellStream'>
  readonly settings: SettingsStore
  readonly presence: ClientPresence
  readonly push: PushService
  readonly link: (fed: FedNotice) => Promise<SessionLink>
  readonly retryMs?: number
}

// A notice an hour old is news nobody needs.
const NOTICE_TTL_SECONDS = 3600
const RETRY_MS = 1000

/**
 * Pushes session notices to every registered device while `chat.pushNotifications` is on.
 * It reads the shell stream the tab reads, from a fresh snapshot each time it starts.
 */
export class SessionNoticePush {
  private readonly options: SessionNoticePushOptions
  private readonly stopSettings: () => void
  private watch: AbortController | null = null

  constructor(options: SessionNoticePushOptions) {
    this.options = options
    this.stopSettings = options.settings.onChange(() => this.reconcile())
    this.reconcile()
  }

  close() {
    this.stopSettings()
    this.watch?.abort()
    this.watch = null
  }

  private reconcile() {
    const enabled = this.options.settings.snapshot().values['chat.pushNotifications']
    if (enabled === (this.watch !== null)) return
    if (!enabled) {
      this.watch?.abort()
      this.watch = null
      return
    }
    const watch = new AbortController()
    this.watch = watch
    runDetached(() => this.follow(watch.signal), { area: 'push', operation: 'session_notices' })
  }

  private async follow(signal: AbortSignal) {
    while (!signal.aborted) {
      try {
        await this.followStream(signal)
      } catch (error) {
        if (signal.aborted) return
        recordProcessWarning('push.session_notices.stream_failed', { error: errorSummary(error) })
      }
      await pause(this.options.retryMs ?? RETRY_MS, signal)
    }
  }

  private async followStream(signal: AbortSignal) {
    const feed = createSessionNoticeFeed(this.options.environmentId)
    for await (const frame of this.options.engine.shellStream({ signal })) {
      const fed = feed.accept(frame)
      if (!fed) continue
      runDetached(() => this.deliver(fed), { area: 'push', operation: 'session_notice' })
    }
  }

  private async deliver(fed: FedNotice) {
    const { notice } = fed
    const focusedWindows = this.options.presence.focusedCount
    const event = { kind: notice.kind, failed: notice.failed, focusedWindows }
    if (focusedWindows > 0) {
      recordProcessInfo('push.session_notice', {
        ...event,
        deviceCount: this.options.push.deviceCount(),
        suppressed: true,
      })
      return
    }

    const link = await this.options.link(fed)
    const result = await this.options.push.broadcast(pushNotice(notice, link.path), {
      ttlSeconds: NOTICE_TTL_SECONDS,
      urgency: 'high',
    })
    recordProcessInfo('push.session_notice', {
      ...event,
      deviceCount: result.deviceCount,
      suppressed: false,
      link: link.kind,
      deliveries: result.deliveries.map(({ outcome, service, status, failure }) => ({
        outcome,
        service,
        status,
        failure,
      })),
    })
  }
}

function pushNotice(notice: SessionNotice, path: string) {
  return { title: notice.title, body: notice.body, tag: scopedSessionKey(notice.ref), path }
}

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}
