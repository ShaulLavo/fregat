import { Button } from '@workspace/ui/components/button'

/** A labelled key in the terminal's key row; pressing it leaves focus in the terminal. */
export function KeyButton({
  label,
  onPress,
}: {
  readonly label: string
  readonly onPress: () => void
}) {
  return (
    <Button
      className='font-mono'
      size='sm'
      type='button'
      variant='ghost'
      onClick={onPress}
      onPointerDown={(event) => event.preventDefault()}
    >
      {label}
    </Button>
  )
}
