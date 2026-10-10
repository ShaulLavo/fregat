import { expect, it, onTestFinished, vi } from 'vitest'
import { textureAttachment } from '../texture-attachment.js'

async function createDevice(): Promise<GPUDevice> {
  const adapter = await navigator.gpu.requestAdapter()
  expect(adapter).not.toBeNull()
  const device = await adapter!.requestDevice()
  onTestFinished(() => device.destroy())
  return device
}

it('probes once per physical device and passes supported textures through', async () => {
  const device = await createDevice()
  const createTexture = vi.spyOn(device, 'createTexture')
  onTestFinished(() => createTexture.mockRestore())
  device.pushErrorScope('validation')
  const attachment = textureAttachment(device)
  expect(textureAttachment(device)).toBe(attachment)
  expect(createTexture).toHaveBeenCalledTimes(1)
  const texture = device.createTexture({
    size: [1, 1],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  })
  onTestFinished(() => texture.destroy())
  const createView = vi.spyOn(texture, 'createView')
  onTestFinished(() => createView.mockRestore())
  expect(attachment(texture)).toBe(texture)
  expect(createView).not.toHaveBeenCalled()
  expect(await device.popErrorScope()).toBeNull()
  const replacement = await createDevice()
  const createReplacementTexture = vi.spyOn(replacement, 'createTexture')
  onTestFinished(() => createReplacementTexture.mockRestore())
  textureAttachment(replacement)
  expect(createReplacementTexture).toHaveBeenCalledTimes(1)
})

it('uses explicit views when the external binding rejects texture attachments', async () => {
  const device = await createDevice()
  const encoder = device.createCommandEncoder()
  const begin = vi.spyOn(encoder, 'beginRenderPass').mockImplementation(() => {
    throw new TypeError('Texture attachments are unsupported')
  })
  const createEncoder = vi.spyOn(device, 'createCommandEncoder').mockReturnValue(encoder)
  const createTexture = vi.spyOn(device, 'createTexture')
  const destroy = vi.spyOn(GPUTexture.prototype, 'destroy')
  onTestFinished(() => {
    begin.mockRestore()
    createEncoder.mockRestore()
    createTexture.mockRestore()
    destroy.mockRestore()
  })
  const attachment = textureAttachment(device)
  expect(textureAttachment(device)).toBe(attachment)
  expect(createTexture).toHaveBeenCalledTimes(1)
  expect(destroy).toHaveBeenCalledTimes(1)
  expect(destroy.mock.instances[0]).toBe(createTexture.mock.results[0]!.value)
  const texture = device.createTexture({
    size: [1, 1],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  })
  onTestFinished(() => texture.destroy())
  const view = attachment(texture)
  expect(view).toBeInstanceOf(GPUTextureView)
  expect(view).not.toBe(texture)
})

it('cleans up a failed probe and propagates failures outside the binding capability', async () => {
  const device = await createDevice()
  const encoder = device.createCommandEncoder()
  const failure = new RangeError('External encoder failure')
  const begin = vi.spyOn(encoder, 'beginRenderPass').mockImplementation(() => {
    throw failure
  })
  const createEncoder = vi.spyOn(device, 'createCommandEncoder').mockReturnValue(encoder)
  const createTexture = vi.spyOn(device, 'createTexture')
  const destroy = vi.spyOn(GPUTexture.prototype, 'destroy')
  onTestFinished(() => {
    begin.mockRestore()
    createEncoder.mockRestore()
    createTexture.mockRestore()
    destroy.mockRestore()
  })
  expect(() => textureAttachment(device)).toThrow(failure)
  expect(destroy).toHaveBeenCalledTimes(1)
  expect(destroy.mock.instances[0]).toBe(createTexture.mock.results[0]!.value)
  begin.mockRestore()
  createEncoder.mockRestore()
  textureAttachment(device)
  expect(createTexture).toHaveBeenCalledTimes(2)
})

it('renders identical pixels with implicit and explicit texture views', async () => {
  const device = await createDevice()
  const attachment = textureAttachment(device)
  const outputs: Uint8Array[] = []
  device.pushErrorScope('validation')
  for (const convert of [attachment, (texture: GPUTexture) => texture.createView()]) {
    const texture = device.createTexture({
      size: [1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    })
    const buffer = device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })
    onTestFinished(() => {
      texture.destroy()
      buffer.destroy()
    })
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: convert(texture),
          clearValue: { r: 0.25, g: 0.5, b: 0.75, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    pass.end()
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: 256 }, { width: 1, height: 1 })
    device.queue.submit([encoder.finish()])
    await buffer.mapAsync(GPUMapMode.READ)
    outputs.push(new Uint8Array(buffer.getMappedRange()).slice(0, 4))
    buffer.unmap()
  }
  expect(outputs[0]).toEqual(outputs[1])
  expect(outputs[0]).toEqual(new Uint8Array([64, 128, 191, 255]))
  expect(await device.popErrorScope()).toBeNull()
})
