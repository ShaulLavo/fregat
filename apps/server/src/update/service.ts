import type {
  BusySessionState,
  LiveCheckVerdict,
  ServerRestartResult,
  ServerUpdate as ServerUpdateState,
  ServerUpdatePhase,
  SessionId,
  StagedRelease,
} from '@workspace/contracts'

import { recordProcessInfo, recordRequestContext } from '../observability'
import type { OrchestrationEngine } from '../orchestration/engine'
import { approveRestart, readLiveCheck, readStagedRelease } from './staged-release'
import { updateErrors } from './structured-errors'

/** What the process needs to exit into the staged release, and what `server.stop` logs. */
export type RestartRecord = {
  trigger: 'route'
  from: string | null
  to: string
  stagedAt: string
  interrupted: { sessionId: SessionId; state: BusySessionState }[]
  clientInstance: string | null
}

export type UpdateOptions = {
  /** The production root holding `current` and `pending`. Null leaves the feature inert. */
  root: string | null
  /** Exits the process; called once, after the restart is accepted. */
  restart: (record: RestartRecord) => void
}

export type RereadTrigger = 'signal' | 'release' | 'restart'

type ServerUpdateOptions = UpdateOptions & {
  /** The release the running bundle was loaded from. */
  serverRelease: string | null
  gate: Pick<OrchestrationEngine, 'beginRestart'>
}

type Listener = (state: ServerUpdateState) => void

export class ServerUpdate {
  readonly root: string | null
  private readonly serverRelease: string | null
  private readonly gate: ServerUpdateOptions['gate']
  private readonly restart: UpdateOptions['restart']
  private readonly listeners = new Set<Listener>()
  private phase: ServerUpdatePhase = 'serving'
  private pending: StagedRelease | null = null
  private liveCheck: LiveCheckVerdict | null = null
  private lane: Promise<unknown> = Promise.resolve()

  constructor(options: ServerUpdateOptions) {
    this.root = options.root
    this.serverRelease = options.serverRelease
    this.gate = options.gate
    this.restart = options.restart
    this.pending = readStagedRelease(this.root, this.serverRelease).staged
    this.liveCheck = readLiveCheck(this.root)
  }

  /** A server without a production root never has an update to announce. */
  get enabled() {
    return this.root !== null
  }

  state(): ServerUpdateState {
    return { phase: this.phase, pending: this.pending, liveCheck: this.liveCheck }
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Re-reads `pending` and the live check; publishes and logs only a change. */
  reread(trigger: RereadTrigger) {
    if (!this.enabled) return this.state()

    const read = readStagedRelease(this.root, this.serverRelease)
    const liveCheck = readLiveCheck(this.root)
    const changed =
      !sameStaged(this.pending, read.staged) || !sameLiveCheck(this.liveCheck, liveCheck)
    if (!changed) return this.state()

    this.pending = read.staged
    this.liveCheck = liveCheck
    recordProcessInfo('server.update', {
      trigger,
      phase: this.phase,
      pendingRelease: read.staged?.release ?? null,
      pendingReason: read.reason,
      stagedAt: read.staged?.stagedAt ?? null,
      serverRelease: this.serverRelease,
      liveCheck: liveCheck ? { release: liveCheck.release, status: liveCheck.status } : null,
    })
    this.publish()
    return this.state()
  }

  /** Serialized, so two clicks cannot both pass the busy check. */
  requestRestart(
    interrupt: readonly SessionId[],
    clientInstance: string | null,
  ): Promise<ServerRestartResult> {
    const task = this.lane.then(() => this.restartNow(interrupt, clientInstance))
    this.lane = task.then(noop, noop)
    return task
  }

  private async restartNow(
    interrupt: readonly SessionId[],
    clientInstance: string | null,
  ): Promise<ServerRestartResult> {
    if (this.phase === 'restarting') return { restarting: true }

    this.reread('restart')
    const staged = this.pending
    const root = this.root
    if (!staged || !root) {
      const { reason } = readStagedRelease(this.root, this.serverRelease)
      throw updateErrors.NO_UPDATE_STAGED({ internal: { root: this.root, reason } })
    }

    const answer = await this.gate.beginRestart(new Set(interrupt))
    if (!answer.restarting) {
      recordRequestContext({ update: { answer: 'busy', busyCount: answer.busy.length } })
      return { restarting: false, busy: answer.busy }
    }

    approveRestart(root, staged)
    const interrupted = answer.interrupted.map(({ sessionId, state }) => ({ sessionId, state }))
    recordRequestContext({
      update: {
        answer: 'restarting',
        release: staged.release,
        interruptedCount: interrupted.length,
      },
    })
    this.phase = 'restarting'
    this.publish()
    this.restart({
      trigger: 'route',
      from: this.serverRelease,
      to: staged.release,
      stagedAt: staged.stagedAt,
      interrupted,
      clientInstance,
    })
    return { restarting: true }
  }

  private publish() {
    const state = this.state()
    for (const listener of this.listeners) listener(state)
  }
}

function sameStaged(left: StagedRelease | null, right: StagedRelease | null) {
  return left?.release === right?.release && left?.stagedAt === right?.stagedAt
}

function sameLiveCheck(left: LiveCheckVerdict | null, right: LiveCheckVerdict | null) {
  return (
    left?.release === right?.release && left?.status === right?.status && left?.at === right?.at
  )
}

function noop() {}
