import * as v from 'valibot'

const STORAGE_KEY = 'platform.navigation.pending'
const text = v.pipe(v.string(), v.nonEmpty())
const pendingPublicationSchema = v.object({
  identity: text,
  sourceHref: text,
  href: v.pipe(
    text,
    v.startsWith('/'),
    v.check((value) => !value.startsWith('//')),
  ),
})

export function rememberPendingPublication(value: v.InferOutput<typeof pendingPublicationSchema>) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Storage can be unavailable; live navigation still works.
  }
}

export function clearPendingPublication() {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    return
  }
}

export function takePendingPublication({
  identity,
  href,
  reload,
}: {
  readonly identity: string
  readonly href: string
  readonly reload: boolean
}) {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    sessionStorage.removeItem(STORAGE_KEY)
    if (!reload || !raw) return null
    const result = v.safeParse(pendingPublicationSchema, JSON.parse(raw))
    if (!result.success) return null
    if (result.output.identity !== identity || result.output.sourceHref !== href) return null
    return result.output.href
  } catch {
    return null
  }
}
