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
  let resourceReason: 'unsupported' | 'observer-refused' | null = 'unsupported',
    taskReason: 'unsupported' | 'observer-refused' | null = 'unsupported'
  let resourceObserver: PerformanceObserver | null = null,
    taskObserver: PerformanceObserver | null = null
  const supports = (type: string) => {
    try {
      return PerformanceObserver.supportedEntryTypes.includes(type)
    } catch {
      return false
    }
  }
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
  const collectTasks = (entries: readonly PerformanceEntry[]) => {
    const start = performance.now()
    for (const entry of entries) add(longTasks, entry.duration)
    observerMs += performance.now() - start
  }
  const receiveResources = (list: PerformanceObserverEntryList) =>
    guard(() => collectResources(list.getEntries()))
  const receiveTasks = (list: PerformanceObserverEntryList) =>
    guard(() => collectTasks(list.getEntries()))
  const registerResources = () => {
    resourceReason = 'observer-refused'
    const observer = new PerformanceObserver(receiveResources)
    observer.observe({ type: 'resource', buffered: true })
    resourceObserver = observer
    resourcesSupported = true
    resourceReason = null
  }
  const registerTasks = () => {
    taskReason = 'observer-refused'
    const observer = new PerformanceObserver(receiveTasks)
    observer.observe({ type: 'longtask', buffered: true })
    taskObserver = observer
    tasksSupported = true
    taskReason = null
  }
  if (supports('resource')) guard(registerResources)
  if (supports('longtask')) guard(registerTasks)
  const drainResources = () => {
    if (!resourceObserver) return
    try {
      collectResources(resourceObserver.takeRecords())
    } catch {
      resourcesSupported = false
      resourceReason = 'observer-refused'
    }
  }
  const drainTasks = () => {
    if (!taskObserver) return
    try {
      collectTasks(taskObserver.takeRecords())
    } catch {
      tasksSupported = false
      taskReason = 'observer-refused'
    }
  }
  const emit = (phase: 'dom' | 'load' | 'hide') =>
    guard(() => {
      drainResources()
      drainTasks()
      const navigation = performance.getEntriesByType('navigation')[0]
      const positive = (value: number) => (value > 0 ? value : null)
      const timing =
        typeof PerformanceNavigationTiming === 'function' &&
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
            resourceReason,
            longTasks: tasksSupported ? longTasks : null,
            bytes: resourcesSupported ? bytes : null,
            reason: taskReason,
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
