export function retentionColdBrowser() {
  if (typeof PerformanceObserver !== 'function') return
  const guard = (observe: () => void) => {
    try {
      observe()
    } catch {}
  }
  const histogram = () => ({ count: 0, sumMs: 0, maxMs: 0, buckets: Array<number>(16).fill(0) })
  const resources = histogram(),
    longTasks = histogram()
  let bytes = 0,
    observerMs = 0,
    tasksSupported = false,
    resourcesSupported = false
  const add = (target: ReturnType<typeof histogram>, value: number) => {
    if (!Number.isFinite(value) || value < 0) return
    target.count++
    target.sumMs += value
    target.maxMs = Math.max(target.maxMs, value)
    target.buckets[Math.min(15, Math.max(0, Math.ceil(Math.log2(Math.max(1, value)))))]++
  }
  const collectResources = (entries: readonly PerformanceEntry[]) => {
    const start = performance.now()
    for (const entry of entries) {
      add(resources, entry.duration)
      if (!('transferSize' in entry) || typeof entry.transferSize !== 'number') continue
      bytes += entry.transferSize
    }
    observerMs += performance.now() - start
  }
  const resourceObserver = new PerformanceObserver((list) =>
    guard(() => collectResources(list.getEntries())),
  )
  guard(() => {
    resourceObserver.observe({ type: 'resource', buffered: true })
    resourcesSupported = true
  })
  guard(() => {
    const taskObserver = new PerformanceObserver((list) =>
      guard(() => {
        const start = performance.now()
        for (const entry of list.getEntries()) add(longTasks, entry.duration)
        observerMs += performance.now() - start
      }),
    )
    taskObserver.observe({ type: 'longtask', buffered: true })
    tasksSupported = true
  })
  const emit = (phase: 'dom' | 'load' | 'hide') =>
    guard(() => {
      collectResources(resourceObserver.takeRecords())
      const navigation = performance.getEntriesByType('navigation')[0]
      const positive = (value: number) => (value > 0 ? value : null)
      const timing =
        navigation instanceof PerformanceNavigationTiming
          ? {
              responseStart: positive(navigation.responseStart),
              responseEnd: positive(navigation.responseEnd),
              domInteractive: positive(navigation.domInteractive),
              domContentLoadedEventEnd: positive(navigation.domContentLoadedEventEnd),
              loadEventEnd: positive(navigation.loadEventEnd),
            }
          : null
      console.info(
        'RETENTION_COLD_FACT ' +
          JSON.stringify({
            kind: 'browser',
            phase,
            utcMs: Date.now(),
            timeOriginMs: performance.timeOrigin,
            monotonicMs: performance.now(),
            navigation: timing,
            resources: resourcesSupported ? resources : null,
            resourceReason: resourcesSupported ? null : 'unsupported',
            longTasks: tasksSupported ? longTasks : null,
            bytes: resourcesSupported ? bytes : null,
            reason: tasksSupported ? null : 'unsupported',
            observerMs,
          }),
      )
    })
  guard(() => {
    document.addEventListener('DOMContentLoaded', () => emit('dom'), { once: true })
    window.addEventListener('load', () => emit('load'), { once: true })
    window.addEventListener('pagehide', () => emit('hide'), { once: true })
  })
}
