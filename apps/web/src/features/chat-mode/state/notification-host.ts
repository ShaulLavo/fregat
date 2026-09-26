import { queryOptions, type QueryClient } from '@tanstack/react-query'
import {
  hasNativeNotifications,
  hasNotificationSound,
  scopedSessionKey,
  type EnvironmentId,
  type NotificationMode,
  type ScopedSessionRef,
  type SessionNotice,
} from '@workspace/contracts'
import { toast } from 'sonner'
import { feedbackOutput } from '@workspace/ui/patterns/feedback-layer'
import { chatNotificationQueryKeys } from '@/features/chat-mode/utils/query-keys'

export function createNotificationHost({
  queryClient,
  open,
  active,
}: {
  queryClient: QueryClient
  open: (ref: ScopedSessionRef) => void
  active: () => ScopedSessionRef | null
}) {
  const pending = new Map<string, { environmentId: EnvironmentId; notification: Notification }>()
  const badge = createNotificationBadge()
  let disposed = false
  const clear = () => {
    for (const entry of pending.values()) entry.notification.close()
    pending.clear()
    badge.set(0)
  }
  const play = async (kind: SessionNotice['kind']) => {
    const audio = feedbackOutput('agent')
    if (!audio) return
    try {
      const buffer = await queryClient.fetchQuery(
        queryOptions({
          queryKey: chatNotificationQueryKeys.sound(kind),
          staleTime: Infinity,
          queryFn: async ({ signal }) => {
            const url = new URL(
              `${import.meta.env.BASE_URL}notifications/${kind}.mp3`,
              window.location.href,
            )
            const response = await fetch(url, { signal })
            return audio.context.decodeAudioData(await response.arrayBuffer())
          },
        }),
      )
      const output = feedbackOutput('agent')
      if (disposed || !output) return
      const source = output.context.createBufferSource()
      source.buffer = buffer
      source.connect(output.output)
      source.start()
    } catch {
      // Audio availability and autoplay permission differ between browsers.
    }
  }
  const native = (notice: SessionNotice) => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    try {
      const tag = scopedSessionKey(notice.ref)
      const notification = new Notification(notice.title, { body: notice.body, tag, silent: true })
      pending.get(tag)?.notification.close()
      pending.set(tag, { environmentId: notice.ref.environmentId, notification })
      badge.set(pending.size)
      notification.addEventListener('click', () => {
        notification.close()
        window.focus()
        open(notice.ref)
      })
    } catch {
      // Some hosts expose Notification but reject desktop presentation.
    }
  }
  return {
    configure(mode: NotificationMode) {
      clear()
      window.removeEventListener('focus', clear)
      if (hasNativeNotifications(mode)) window.addEventListener('focus', clear)
    },
    retain(owners: ReadonlySet<EnvironmentId>) {
      for (const [tag, entry] of pending) {
        if (owners.has(entry.environmentId)) continue
        entry.notification.close()
        pending.delete(tag)
      }
      badge.set(pending.size)
    },
    deliver(notice: SessionNotice, mode: NotificationMode, inApp: boolean) {
      if (hasNotificationSound(mode)) void play(notice.kind)
      const focused = document.visibilityState === 'visible' && document.hasFocus()
      const selected = active()
      const sameSession =
        selected?.environmentId === notice.ref.environmentId &&
        selected.sessionId === notice.ref.sessionId
      if (inApp && focused && !sameSession) {
        const show = noticeToast(notice)
        show(notice.title, {
          description: notice.body,
          action: { label: 'Open session', onClick: () => open(notice.ref) },
        })
        return
      }
      if (!focused && hasNativeNotifications(mode)) native(notice)
    },
    dispose() {
      disposed = true
      clear()
      window.removeEventListener('focus', clear)
    },
  }
}

function noticeToast(notice: SessionNotice) {
  if (notice.kind === 'completion') return toast.success
  if (notice.failed) return toast.error
  return toast.warning
}

// Repaints the page's one icon link in place; a second link would leave two owners of the favicon.
function createNotificationBadge() {
  let pageIcon: { readonly href: string; readonly type: string } | null = null
  let count = 0
  return {
    set(next: number) {
      if (next === count) return
      count = next
      const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
      if (!icon) return
      if (!next) {
        restorePageIcon(icon, pageIcon)
        pageIcon = null
        return
      }
      const badge = drawNotificationBadge(next)
      if (!badge) return
      pageIcon ??= { href: icon.href, type: icon.type }
      icon.type = 'image/png'
      icon.dataset.sessionNotifications = 'true'
      icon.href = badge
    },
  }
}

function restorePageIcon(
  icon: HTMLLinkElement,
  pageIcon: { readonly href: string; readonly type: string } | null,
) {
  if (!pageIcon) return

  icon.type = pageIcon.type
  icon.href = pageIcon.href
  delete icon.dataset.sessionNotifications
}

function drawNotificationBadge(count: number) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const context = canvas.getContext('2d')
  if (!context) return null
  const theme = getComputedStyle(document.documentElement)
  context.fillStyle = theme.getPropertyValue('--destructive').trim()
  context.beginPath()
  context.arc(32, 32, 28, 0, Math.PI * 2)
  context.fill()
  context.fillStyle =
    theme.getPropertyValue('--destructive-foreground').trim() ||
    theme.getPropertyValue('--foreground').trim()
  context.font = `600 ${count > 9 ? 30 : 40}px sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(count > 9 ? '9+' : String(count), 32, 34)
  return canvas.toDataURL('image/png')
}
