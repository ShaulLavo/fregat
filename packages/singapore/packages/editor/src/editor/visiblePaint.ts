import type { EditorVisiblePaintLayer, EditorVisiblePaintRectangle } from '../plugins'

export const MAX_VISIBLE_PAINT_LAYERS = 32
export const MAX_VISIBLE_PAINT_RECTANGLES = 8192

export function copyEditorVisiblePaintLayer(
  layer: EditorVisiblePaintLayer,
  remainingRectangles = MAX_VISIBLE_PAINT_RECTANGLES,
): EditorVisiblePaintLayer {
  if (typeof layer.id !== 'string' || !layer.id || layer.id.length > 128) {
    throw new RangeError('Editor snapshot paint layer id must contain 1 to 128 characters')
  }
  if (layer.rectangles.length > remainingRectangles) {
    throw new RangeError('Editor snapshot paint rectangles exceed the visible paint limit')
  }
  return { id: layer.id, rectangles: layer.rectangles.map(copyRectangle) }
}

export function copyEditorVisiblePaintLayers(
  layers: readonly EditorVisiblePaintLayer[],
): EditorVisiblePaintLayer[] {
  if (layers.length > MAX_VISIBLE_PAINT_LAYERS) {
    throw new RangeError('Editor snapshot paint layers exceed the visible paint limit')
  }
  const ids = new Set<string>()
  let remainingRectangles = MAX_VISIBLE_PAINT_RECTANGLES
  return layers.map((layer) => {
    if (ids.has(layer.id)) throw new RangeError('Editor snapshot paint layer ids must be unique')
    ids.add(layer.id)
    const copy = copyEditorVisiblePaintLayer(layer, remainingRectangles)
    remainingRectangles -= copy.rectangles.length
    return copy
  })
}

export function freezeEditorVisiblePaintLayers(
  layers: EditorVisiblePaintLayer[],
): readonly EditorVisiblePaintLayer[] {
  for (const layer of layers) {
    for (const rectangle of layer.rectangles) Object.freeze(rectangle)
    Object.freeze(layer.rectangles)
    Object.freeze(layer)
  }
  return Object.freeze(layers)
}

function copyRectangle(rectangle: EditorVisiblePaintRectangle): EditorVisiblePaintRectangle {
  const { left, top, width, height, backgroundColor } = rectangle
  if (
    !Number.isFinite(left) ||
    !Number.isFinite(top) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    throw new RangeError('Editor snapshot paint rectangle coordinates must be finite')
  }
  if (width <= 0 || height <= 0) {
    throw new RangeError('Editor snapshot paint rectangle dimensions must be positive')
  }
  if (typeof backgroundColor !== 'string' || !backgroundColor || backgroundColor.length > 256) {
    throw new RangeError('Editor snapshot paint rectangle color must contain 1 to 256 characters')
  }
  return { left, top, width, height, backgroundColor }
}
