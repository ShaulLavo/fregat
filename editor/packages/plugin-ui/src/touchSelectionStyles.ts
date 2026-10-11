export const TOUCH_SELECTION_STYLES = `
.editor-touch-menu {
  --editor-touch-menu-background: var(--popover-solid, var(--popover, #f8f8fa));
  --editor-touch-menu-foreground: var(--popover-foreground, var(--foreground, #19191c));
  position: fixed;
  z-index: var(--editor-z-overlay-popup);
  display: flex;
  align-items: center;
  max-width: calc(100vw - 16px);
  border-radius: 12px;
  color: var(--editor-touch-menu-foreground);
  background: var(--editor-touch-menu-background);
  box-shadow: 0 4px 16px rgb(0 0 0 / 0.18);
  font:
    14px/1.2 system-ui,
    sans-serif;
  white-space: nowrap;
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}

.editor-touch-menu::after {
  content: '';
  position: absolute;
  left: var(--editor-touch-arrow-x);
  width: 12px;
  height: 12px;
  background: inherit;
  transform: translateX(-50%) rotate(45deg);
}

.editor-touch-menu[data-side='top']::after {
  bottom: -5px;
}
.editor-touch-menu[data-side='bottom']::after {
  top: -5px;
}

.editor-touch-menu-actions {
  display: flex;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  border-radius: inherit;
}

.editor-touch-menu [data-action] {
  box-sizing: border-box;
  position: relative;
  z-index: 1;
  min-height: 44px;
  border: 0;
  border-radius: 10px;
  padding: 8px 12px;
  color: inherit;
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.editor-touch-menu [data-action]:active,
.editor-touch-menu [data-action]:hover {
  background: var(--row-hover, rgb(128 128 128 / 0.15));
}
.editor-touch-menu [data-action][aria-disabled="true"] {
  opacity: 0.45;
}
.editor-touch-menu [data-action]:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: -3px;
}
.editor-touch-menu [role='status'] {
  position: absolute;
  top: calc(100% + 12px);
  padding: 8px;
  background: inherit;
  color: inherit;
  border-radius: 8px;
  white-space: normal;
}

@media (prefers-color-scheme: dark) {
  .editor-touch-menu {
    --editor-touch-menu-background: var(--popover-solid, var(--popover, #303033));
    --editor-touch-menu-foreground: var(--popover-foreground, var(--foreground, #f5f5f7));
  }
}
`
