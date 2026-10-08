export function geometrySample({
  firstIndex,
  lastIndex,
  firstTop,
  lastBottom,
  viewportTop,
  viewportHeight,
  scrollTop,
  rowHeight,
}) {
  const apparentScrollTop = firstIndex * rowHeight - (firstTop - viewportTop)
  return {
    apparentScrollTop,
    lagPx: apparentScrollTop - scrollTop,
    blankPx: Math.min(
      viewportHeight,
      Math.max(0, firstTop - viewportTop) + Math.max(0, viewportTop + viewportHeight - lastBottom),
    ),
    firstIndex,
    lastIndex,
  }
}

export function percentile(values, fraction) {
  if (!values.length) return null
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
}

export function summarize(run) {
  const frames = run.frames.filter((frame) => frame.moving)
  const hasGeometry = frames.some((frame) => frame.blankPx !== null)
  return {
    scrollEvents: run.events.length,
    movingFrames: frames.length,
    frameIntervalP95Ms: percentile(
      frames.map((frame) => frame.dt),
      0.95,
    ),
    absoluteLagP95Px: percentile(
      frames.filter((frame) => frame.lagPx !== null).map((frame) => Math.abs(frame.lagPx)),
      0.95,
    ),
    absoluteLagMaxPx: percentile(
      frames.filter((frame) => frame.lagPx !== null).map((frame) => Math.abs(frame.lagPx)),
      1,
    ),
    blankFrames: hasGeometry ? frames.filter((frame) => frame.blankPx > 1).length : null,
    blankMaxPx: hasGeometry
      ? percentile(
          frames.map((frame) => frame.blankPx ?? 0),
          1,
        )
      : null,
    measurementCostP95Ms: percentile(
      run.frames.map((frame) => frame.measurementCostMs),
      0.95,
    ),
    longTasks: run.longTasksSupported ? run.longTasks.length : null,
  }
}
