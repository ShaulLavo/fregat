import * as v from 'valibot'
import { environmentIdSchema } from './chat-ids'

/** Bumped when the identity or capabilities shape changes incompatibly. */
export const SERVER_IDENTITY_PROTOCOL_VERSION = 1

/** An app-specific hash of the OS machine id: equal on every state home of one machine. */
export const machineIdSchema = v.pipe(v.string(), v.regex(/^[0-9a-f]{32}$/), v.brand('MachineId'))

/** POSIX `/x`, drive `C:\x` or `C:/x`, or UNC `\\host\share`. Drive-relative `C:x` and NUL are refused. */
export const absolutePathSchema = v.pipe(
  v.string(),
  v.maxLength(4096),
  v.regex(/^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/, 'An absolute path'),
  v.check((value) => !value.includes('\0'), 'A path holds no NUL byte'),
)

/** The stable public listener as a bare origin, e.g. `http://127.0.0.1:3301`. */
export const serverAddressSchema = v.pipe(
  v.string(),
  v.check((value) => {
    const url = URL.parse(value)
    return (
      url !== null &&
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === value
    )
  }, 'An address is an http(s) origin with no path'),
)

/** The path the web client is served under: `/` or `/platform/`. */
export const webBaseSchema = v.pipe(v.string(), v.regex(/^\/(?:[A-Za-z0-9._~-]+\/)*$/))

/**
 * Who keeps the server running. `systemd-socket` and `launchd` hold the listener while the server
 * is absent; `systemd-service` is a continuously running unit; `unmanaged` is a hand-started process.
 */
export const serverServiceKindSchema = v.picklist([
  'launchd',
  'systemd-socket',
  'systemd-service',
  'unmanaged',
])

export const serverServiceSchema = v.object({
  kind: serverServiceKindSchema,
  /** The LaunchAgent label or systemd unit name; null for an unmanaged process. */
  registrationId: v.nullable(v.pipe(v.string(), v.minLength(1), v.maxLength(256))),
})

/** `GET /system/identity`: answered only to this machine's own requests. */
export const serverIdentitySchema = v.object({
  product: v.literal('fregat'),
  protocolVersion: v.pipe(v.number(), v.integer(), v.minValue(1)),
  machineId: machineIdSchema,
  environmentId: environmentIdSchema,
  /** Canonical (symlinks resolved) state home. */
  stateHome: absolutePathSchema,
  address: serverAddressSchema,
  webBase: webBaseSchema,
  service: serverServiceSchema,
})

/**
 * `GET /system/capabilities`, evaluated for the request that asked. `nativePicker` is true only
 * when that request is local (loopback socket, the install origin, no proxy hop) and a native
 * helper with a usable desktop session exists.
 */
export const serverCapabilitiesSchema = v.object({
  machineId: machineIdSchema,
  environmentId: environmentIdSchema,
  nativePicker: v.boolean(),
})

/** What one-time setup expects to find, or create, at the fixed address. */
export const machineServiceIntentSchema = v.object({
  stateHome: absolutePathSchema,
  address: serverAddressSchema,
  webBase: webBaseSchema,
  /** Null on a first install, before the state home holds a database. */
  expected: v.nullable(
    v.object({
      machineId: machineIdSchema,
      environmentId: v.nullable(environmentIdSchema),
    }),
  ),
})

export const machineServiceDispositionSchema = v.picklist(['registered', 'reused'])

export const machineServiceResultSchema = v.object({
  identity: serverIdentitySchema,
  disposition: machineServiceDispositionSchema,
})

/** Codes `ensureMachineService` rejects with; each carries `why` and `fix`. */
export const machineServiceErrorCodes = [
  'service.ADDRESS_HELD_BY_OTHER_PROGRAM',
  'service.ADDRESS_HELD_BY_OTHER_FREGAT',
  'service.IDENTITY_UNVERIFIED',
  'service.REGISTRATION_FAILED',
  'service.UNSUPPORTED_PLATFORM',
] as const

/** Codes the server answers `/system/*` with. */
export const serverIdentityErrorCodes = ['system.NOT_LOCAL', 'system.STATE_HOME_LOCKED'] as const

export type MachineId = v.InferOutput<typeof machineIdSchema>
export type ServerServiceKind = v.InferOutput<typeof serverServiceKindSchema>
export type ServerService = v.InferOutput<typeof serverServiceSchema>
export type ServerIdentity = v.InferOutput<typeof serverIdentitySchema>
export type ServerCapabilities = v.InferOutput<typeof serverCapabilitiesSchema>
export type MachineServiceIntent = v.InferOutput<typeof machineServiceIntentSchema>
export type MachineServiceDisposition = v.InferOutput<typeof machineServiceDispositionSchema>
export type MachineServiceResult = v.InferOutput<typeof machineServiceResultSchema>
export type MachineServiceErrorCode = (typeof machineServiceErrorCodes)[number]
export type ServerIdentityErrorCode = (typeof serverIdentityErrorCodes)[number]
