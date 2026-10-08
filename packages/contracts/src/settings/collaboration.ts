import * as v from 'valibot'

export const COLLABORATION_ADMISSION_TOKEN_REF = 'collaboration.brokerAdmissionToken'
export const COLLABORATION_TURN_CREDENTIALS_REF = 'collaboration.turnCredentials'

export type CollaborationSecretRef =
  | typeof COLLABORATION_ADMISSION_TOKEN_REF
  | typeof COLLABORATION_TURN_CREDENTIALS_REF

export const collaborationSignalingUrlsSchema = v.array(
  v.pipe(
    v.string(),
    v.url(),
    v.check((value) => {
      if (!URL.canParse(value)) return false
      const url = new URL(value)
      return (
        ['ws:', 'wss:'].includes(url.protocol) &&
        Boolean(url.hostname) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      )
    }, 'Use a ws or wss URL with a host and a path.'),
  ),
)

const iceUrlSchema = v.pipe(
  v.string(),
  v.regex(
    /^(?:stuns?:|turns?:)(?:[a-zA-Z\d](?:[a-zA-Z\d.-]*[a-zA-Z\d])?|\[[a-fA-F\d:]+\])(?::\d{1,5})?(?:\?transport=(?:udp|tcp))?$/,
    'Use a STUN or TURN server URI.',
  ),
  v.check((value) => {
    const [address, query] = value.split('?')
    if (query && !/^turns?:/i.test(value)) return false
    if (!URL.canParse(`http://${address!.slice(address!.indexOf(':') + 1)}`)) return false
    const port = address!.match(/:(\d+)$/)?.[1]
    return port === undefined || (Number(port) > 0 && Number(port) <= 65535)
  }, 'Use a valid ICE port and a TURN transport parameter.'),
)

export const collaborationIceServersSchema = v.array(
  v.strictObject({
    urls: v.union([iceUrlSchema, v.pipe(v.array(iceUrlSchema), v.minLength(1))]),
  }),
)

export const collaborationDisplayNameSchema = v.pipe(
  v.string(),
  v.maxLength(128),
  v.check((value) => !/[\p{Cc}\p{Cf}]/u.test(value), 'Use a printable presence name.'),
)

export const collaborationColourSchema = v.union([
  v.literal(''),
  v.pipe(v.string(), v.regex(/^#[\da-fA-F]{6}$/, 'Use a six-digit hex colour.')),
])
