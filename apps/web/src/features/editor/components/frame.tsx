import { EditorHost } from '@singapore-editor/react'
import {
  memo,
  useEffect,
  useEffectEvent,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from 'react'

import { EditorTextMenu } from '@/features/editor/components/text-menu'
import { useContextMenu } from '@/keymap/menus/hooks/use-context-menu'

type EditorFrameProps = {
  active: boolean
  controller: ComponentProps<typeof EditorHost>['controller']
  targetRef?: Ref<HTMLDivElement>
  children?: ReactNode
  onRequestCloseOverlay?: (restoreOrigin: boolean) => void
  /** Changes each time a command asks for the text menu at the caret. */
  textMenuRequest?: number | null
}

export const EditorFrame = memo(
  ({
    active,
    controller,
    targetRef,
    children,
    onRequestCloseOverlay,
    textMenuRequest = null,
  }: EditorFrameProps) => {
    const contextMenu = useContextMenu()
    const [menuOffset, setMenuOffset] = useState<number | null>(null)

    // The input element rides on the caret's row, so it anchors the menu where the caret is.
    const openAtCaret = useEffectEvent(() => {
      const editor = controller.getEditor()
      if (!editor) return
      setMenuOffset(caretOffset(controller))
      contextMenu.openAtElement(editor.getInputElement())
    })

    useEffect(() => {
      if (textMenuRequest !== null) openAtCaret()
    }, [textMenuRequest])

    // `contextmenu` bubbles out of the editor's own DOM, so the frame is the
    // one element we own that sees every right-click inside the editor.
    function handleContextMenu(event: MouseEvent<HTMLDivElement>) {
      setMenuOffset(
        controller.getEditor()?.textOffsetFromPoint(event.clientX, event.clientY) ?? null,
      )
      contextMenu.openAtEvent(event, event.currentTarget)
    }

    function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      if (event.key === 'Escape' && onRequestCloseOverlay) {
        event.preventDefault()
        event.stopPropagation()
        onRequestCloseOverlay(true)
        return
      }

      if (contextMenu.openOnMenuKey(event)) setMenuOffset(caretOffset(controller))
    }

    // On the host's own wrapper, so a press in an overlay rendered as `children` never closes it.
    function handleHostPointerDown() {
      onRequestCloseOverlay?.(false)
    }

    return (
      <div
        className='relative flex h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden'
        data-editor-focus-active={active ? 'true' : 'false'}
        ref={targetRef}
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyDown}
      >
        <div className='contents' onPointerDownCapture={handleHostPointerDown}>
          <EditorHost className='app-editor-host' controller={controller} />
        </div>
        {children}
        {contextMenu.anchor ? (
          <EditorTextMenu
            anchor={contextMenu.anchor}
            editor={controller.getEditor()}
            offset={menuOffset}
            onOpenChange={contextMenu.onOpenChange}
          />
        ) : null}
      </div>
    )
  },
)

function caretOffset(controller: EditorFrameProps['controller']): number | null {
  return controller.getEditor()?.getSelections()[0]?.headOffset ?? null
}
