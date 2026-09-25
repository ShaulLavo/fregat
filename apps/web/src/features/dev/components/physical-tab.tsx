import { useEffect, useState } from 'react'
import { Button } from '@workspace/ui/components/button'
import { Switch } from '@workspace/ui/components/switch'
import { Input } from '@workspace/ui/components/input'
import { Slider } from '@workspace/ui/components/slider'
import { Ticker } from '@workspace/ui/components/ticker'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@workspace/ui/components/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { Tabs, TabsList, TabsTab } from '@workspace/ui/components/tabs'
import { ListRow } from '@workspace/ui/patterns/list-row'
import { useFeedbackLayer } from '@workspace/ui/hooks/use-feedback-layer'
import { configureFeedback } from '@workspace/ui/patterns/feedback-layer'

/** Real primitives, together, for comparing feel and reduced motion on a device. */
export function PhysicalTab() {
  const [checked, setChecked] = useState(false)
  const [sounds, setSounds] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const [value, setValue] = useState(50)
  useFeedbackLayer()
  useEffect(() => {
    configureFeedback({ channels: sounds ? ['controls'] : [], volume: 50 })
    return () => configureFeedback({ channels: [], volume: 50 })
  }, [sounds])
  return (
    <div
      className='mx-auto flex max-w-xl flex-col gap-6 p-(--density-section-padding)'
      data-physical-gallery
    >
      <h1 className='text-sm font-semibold'>Physical controls</h1>
      <p className='text-muted-foreground text-xs'>
        Uses the Feel selected in Settings. Compare pointer and keyboard presses with your system’s
        reduced motion setting.
      </p>
      <label className='flex items-center gap-2 text-xs'>
        <Switch checked={sounds} onCheckedChange={setSounds} />
        Control sounds in this preview
      </label>
      <div className='flex gap-3'>
        <Button onClick={() => setValue((current) => current + 1)}>Press me</Button>
        <Button variant='ghost'>Ghost control</Button>
        <Button disabled>Disabled control</Button>
      </div>
      <label className='flex items-center gap-2 text-xs'>
        <Switch checked={checked} onCheckedChange={setChecked} />
        Preview switch
      </label>
      <Slider aria-label='Preview slider' value={value} onValueChange={setValue} />
      <Ticker value={value} />
      <Tabs defaultValue='one'>
        <TabsList aria-label='Preview tabs'>
          <TabsTab value='one'>One</TabsTab>
          <TabsTab value='two'>Two</TabsTab>
          <TabsTab value='three'>Three</TabsTab>
        </TabsList>
      </Tabs>
      <div className='flex gap-3'>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button />}>Preview menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Sample action</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Dialog>
          <DialogTrigger render={<Button />}>Preview dialog</DialogTrigger>
          <DialogContent>
            <DialogTitle>Physical dialog</DialogTitle>
            <p>Press Escape to close.</p>
          </DialogContent>
        </Dialog>
      </div>
      <Input aria-label='Preview field' aria-invalid={invalid} placeholder='Preview field' />
      <Button onClick={() => setInvalid((current) => !current)}>Toggle invalid field</Button>
      <ListRow role='option' onClick={() => setValue((current) => current + 1)}>
        Silent row
      </ListRow>
    </div>
  )
}
