export function recordingCanvas() {
  const stats = { calls: 0, glyphs: 0, clears: 0, backgrounds: 0 }
  const context = { fillStyle: '', font: '', globalAlpha: 1 }
  for (const name of [
    'beginPath',
    'clip',
    'rect',
    'restore',
    'save',
    'lineTo',
    'moveTo',
    'setLineDash',
    'stroke',
    'strokeRect',
  ]) {
    context[name] = function recordCanvasCommand() {
      stats.calls += 1
    }
  }
  context.fillText = function recordCanvasGlyph() {
    stats.calls += 1
    stats.glyphs += 1
  }
  context.fillRect = function recordCanvasBackground() {
    stats.calls += 1
    stats.backgrounds += 1
  }
  context.clearRect = function recordCanvasClear() {
    stats.calls += 1
    stats.clears += 1
  }
  return { context, stats }
}
