type TextureAttachment = (texture: GPUTexture) => GPUTexture | GPUTextureView

const attachments = new WeakMap<GPUDevice, TextureAttachment>()
const useTexture: TextureAttachment = (texture) => texture
const useView: TextureAttachment = (texture) => texture.createView()

export function textureAttachment(device: GPUDevice): TextureAttachment {
  const existing = attachments.get(device)
  if (existing) return existing
  const texture = device.createTexture({
    format: 'rgba8unorm',
    size: [1, 1],
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  })
  let attachment = useTexture
  try {
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'discard',
          view: texture,
        },
      ],
    })
    pass.end()
    encoder.finish()
  } catch (cause) {
    // Texture-view-only WebIDL bindings reject GPUTexture before GPU validation begins.
    if (!(cause instanceof TypeError)) throw cause
    attachment = useView
  } finally {
    texture.destroy()
  }
  attachments.set(device, attachment)
  return attachment
}
