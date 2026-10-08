import * as v from 'valibot'

import { isoDateTimeSchema } from './chat-model'

/**
 * A pairing code: 12 characters from a 32-symbol alphabet with no 0, 1, I or O, about 60 bits. It
 * rides in a link's fragment (`pair#token=…`), never a query, so it reaches no request log.
 */
export const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const PAIRING_CODE_LENGTH = 12
export const pairingCodeSchema = v.pipe(
  v.string(),
  v.regex(new RegExp(`^[${PAIRING_CODE_ALPHABET}]{${PAIRING_CODE_LENGTH}}$`)),
)

/**
 * How a request reached this server: from this machine, from a paired device, from a Tailscale
 * device signed in as this machine's own user, or none of these.
 */
export const pairingTrustSchema = v.picklist(['host', 'device', 'tailnet', 'unpaired'])
export type PairingTrust = v.InferOutput<typeof pairingTrustSchema>

export const pairingStatusSchema = v.object({
  trust: pairingTrustSchema,
  /** False when this machine lets any device in without pairing. */
  required: v.boolean(),
})
export type PairingStatus = v.InferOutput<typeof pairingStatusSchema>

export const pairingLinkSchema = v.object({
  code: pairingCodeSchema,
  expiresAt: isoDateTimeSchema,
})
export type PairingLink = v.InferOutput<typeof pairingLinkSchema>

export const pairingClaimSchema = v.object({
  code: pairingCodeSchema,
  label: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80)),
})
export type PairingClaim = v.InferOutput<typeof pairingClaimSchema>

export const pairedDeviceSchema = v.object({
  id: v.string(),
  label: v.string(),
  pairedAt: isoDateTimeSchema,
  lastSeenAt: isoDateTimeSchema,
  /** The device asking: it cannot remove itself, so it cannot lock itself out by accident. */
  current: v.boolean(),
})
export type PairedDevice = v.InferOutput<typeof pairedDeviceSchema>

export const pairedDevicesSchema = v.object({ devices: v.array(pairedDeviceSchema) })
