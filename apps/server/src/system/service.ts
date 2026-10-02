import { realpathSync } from 'node:fs'
import path from 'node:path'
import {
  SERVER_IDENTITY_PROTOCOL_VERSION,
  type EnvironmentId,
  type MachineId,
  type ServerCapabilities,
  type ServerIdentity,
  type ServerService,
} from '@workspace/contracts'
import type { Server } from 'bun'
import type { NativePicker } from '../fs/native-picker'
import { identityProof, readIdentityKey } from './identity-key'
import { isLocal, localityFacts } from './locality'
import { systemErrors } from './structured-errors'

/** Who sent a request: the socket's remote address, or null when there is no socket. */
export type PeerAddress = (request: Request, server: Server<unknown> | null) => string | null

export type SystemOptions = {
  /** The stable public listener, a bare origin. Also the installed app's origin. */
  address: string
  webBase: string
  service: ServerService
  stateHome: string
  environmentId: EnvironmentId
  machineId: () => MachineId
  peer: PeerAddress
  picker: NativePicker
}

export const socketPeer: PeerAddress = (request, server) =>
  server?.requestIP(request)?.address ?? null

/** Server identity, request locality and the native chooser behind it. */
export class SystemService {
  private readonly options: SystemOptions

  constructor(options: SystemOptions) {
    this.options = options
  }

  locality(request: Request, server: Server<unknown> | null) {
    return localityFacts(request, this.options.peer(request, server), [this.options.address])
  }

  requireLocal(request: Request, server: Server<unknown> | null) {
    const facts = this.locality(request, server)
    if (!isLocal(facts)) throw systemErrors.NOT_LOCAL({ internal: facts })
  }

  identity(): ServerIdentity {
    return {
      product: 'fregat',
      protocolVersion: SERVER_IDENTITY_PROTOCOL_VERSION,
      machineId: this.options.machineId(),
      environmentId: this.options.environmentId,
      stateHome: canonicalPath(this.options.stateHome),
      address: this.options.address,
      webBase: this.options.webBase,
      service: this.options.service,
    }
  }

  /** Null when this server holds no identity key, so setup cannot verify it. */
  proof(nonce: string) {
    const key = readIdentityKey(this.options.stateHome)
    return key ? identityProof(key, nonce) : null
  }

  capabilities(request: Request, server: Server<unknown> | null): ServerCapabilities {
    return {
      machineId: this.options.machineId(),
      environmentId: this.options.environmentId,
      nativePicker: isLocal(this.locality(request, server)) && this.options.picker.available(),
    }
  }

  pickNative(request: Request, server: Server<unknown> | null, body: unknown) {
    const facts = this.locality(request, server)
    if (!isLocal(facts)) throw systemErrors.NATIVE_PICKER_NOT_LOCAL({ internal: facts })
    return this.options.picker.pick(body, request.signal)
  }
}

function canonicalPath(directory: string) {
  try {
    return realpathSync(directory)
  } catch {
    return path.resolve(directory)
  }
}
