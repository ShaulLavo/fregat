import type { EditorVisibleSnapshotJSON } from '@singapor/core'

export function EditorVisiblePaintLayers({
  indentationGuidesEnabled,
  snapshot,
}: {
  readonly indentationGuidesEnabled: boolean
  readonly snapshot: EditorVisibleSnapshotJSON
}) {
  return (
    <div className='pointer-events-none absolute inset-0 z-[1] overflow-hidden'>
      {snapshot.paintLayers.map((layer) => {
        if (layer.id === 'scope-lines' && !indentationGuidesEnabled) return null

        return (
          <div data-editor-visible-paint-layer={layer.id} key={layer.id}>
            {layer.rectangles.map((rectangle, index) => (
              <div
                className='absolute'
                data-editor-visible-paint-rectangle=''
                key={index}
                style={{
                  backgroundColor: rectangle.backgroundColor,
                  height: rectangle.height,
                  left: rectangle.left - snapshot.viewport.scrollLeft,
                  top: rectangle.top - snapshot.viewport.scrollTop,
                  width: rectangle.width,
                }}
              />
            ))}
          </div>
        )
      })}
    </div>
  )
}
