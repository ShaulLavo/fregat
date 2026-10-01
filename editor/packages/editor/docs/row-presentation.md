# row presentation handles

View contributions can call `context.getRowPresentation(displayRow)` to acquire the mounted row
and an abort signal. The signal fires synchronously before logical text replacement, recycling,
provisional paint, or view disposal, while the old text and attached element are still available.
Acquisition returns `null` for an unmounted row or during its invalidation callback.

```ts
const row = context.getRowPresentation(displayRow)
if (row) {
  row.element.classList.add('flash')
  row.signal.addEventListener('abort', () => row.element.classList.remove('flash'))
}
```

Decoration, position, and horizontal chunk-window updates preserve a handle. Plugins whose effects
depend on viewport geometry should cancel them in `updateViewport`. Call `handle.dispose()` to
release a handle. Release is idempotent and does not abort the signal, so abort listeners only
report invalidation by the editor.
