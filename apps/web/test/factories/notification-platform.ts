import { vi, onTestFinished } from 'vitest'

export function installNotificationPlatform() {
  const notifications: NativeNotification[] = []
  const audio = { plays: 0, resumes: 0, closes: 0 }
  class NativeNotification extends EventTarget {
    static permission: NotificationPermission = 'granted'
    readonly tag: string
    closed = false
    constructor(
      readonly title: string,
      readonly options: NotificationOptions,
    ) {
      super()
      this.tag = options.tag ?? ''
      notifications.push(this)
    }
    close() {
      this.closed = true
    }
  }
  class AudioContextBoundary {
    state = 'suspended'
    destination = {}
    resume() {
      audio.resumes++
      this.state = 'running'
      return Promise.resolve()
    }
    close() {
      audio.closes++
      this.state = 'closed'
      return Promise.resolve()
    }
    createBufferSource() {
      return {
        buffer: null,
        connect() {},
        start() {
          audio.plays++
        },
      }
    }
  }
  vi.stubGlobal('Notification', NativeNotification)
  vi.stubGlobal('AudioContext', AudioContextBoundary)
  const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
  const windowFocus = vi.spyOn(window, 'focus').mockImplementation(() => {})
  onTestFinished(() => {
    vi.unstubAllGlobals()
    focus.mockRestore()
    windowFocus.mockRestore()
  })
  return { notifications, audio, focus, windowFocus, Notification: NativeNotification }
}
