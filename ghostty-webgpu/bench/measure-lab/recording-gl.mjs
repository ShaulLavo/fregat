export function recordingGl() {
  const stats = { calls: 0, uploadBytes: 0, draws: 0, instances: 0 }
  const gl = {}
  const constants = [
    'MAX_TEXTURE_SIZE',
    'MAX_ARRAY_TEXTURE_LAYERS',
    'PIXEL_UNPACK_BUFFER',
    'PIXEL_PACK_BUFFER',
    'UNPACK_ALIGNMENT',
    'UNPACK_FLIP_Y_WEBGL',
    'UNPACK_PREMULTIPLY_ALPHA_WEBGL',
    'UNPACK_ROW_LENGTH',
    'PACK_ALIGNMENT',
    'FRAMEBUFFER',
    'DEPTH_TEST',
    'STENCIL_TEST',
    'CULL_FACE',
    'SCISSOR_TEST',
    'DITHER',
    'BLEND',
    'FUNC_ADD',
    'ONE',
    'ONE_MINUS_SRC_ALPHA',
    'COLOR_BUFFER_BIT',
    'VERTEX_SHADER',
    'FRAGMENT_SHADER',
    'COMPILE_STATUS',
    'LINK_STATUS',
    'ARRAY_BUFFER',
    'DYNAMIC_DRAW',
    'FLOAT',
    'TEXTURE_2D_ARRAY',
    'R8',
    'RGBA8',
    'TEXTURE_MIN_FILTER',
    'TEXTURE_MAG_FILTER',
    'LINEAR',
    'TEXTURE_WRAP_S',
    'TEXTURE_WRAP_T',
    'CLAMP_TO_EDGE',
    'TEXTURE0',
    'TEXTURE1',
    'RED',
    'RGBA',
    'UNSIGNED_BYTE',
    'TRIANGLES',
  ]
  for (const [index, name] of constants.entries()) gl[name] = index + 1
  gl.NO_ERROR = 0
  for (const name of [
    'bindFramebuffer',
    'viewport',
    'disable',
    'colorMask',
    'enable',
    'blendEquation',
    'blendFunc',
    'clearColor',
    'clear',
    'bindVertexArray',
    'useProgram',
    'shaderSource',
    'compileShader',
    'attachShader',
    'linkProgram',
    'bindBuffer',
    'bufferData',
    'enableVertexAttribArray',
    'vertexAttribPointer',
    'vertexAttribDivisor',
    'uniform2f',
    'bindTexture',
    'texStorage3D',
    'texParameteri',
    'uniform1i',
    'activeTexture',
    'pixelStorei',
    'deleteShader',
    'deleteProgram',
    'deleteBuffer',
    'deleteTexture',
    'deleteVertexArray',
  ]) {
    gl[name] = function recordCommand() {
      stats.calls += 1
    }
  }
  const resource = {}
  for (const name of [
    'createShader',
    'createProgram',
    'createBuffer',
    'createVertexArray',
    'createTexture',
    'getUniformLocation',
  ])
    gl[name] = () => resource
  gl.getParameter = () => 16384
  gl.getShaderParameter = gl.getProgramParameter = () => true
  gl.getError = () => 0
  gl.bufferSubData = function recordUpload(target, offset, data, sourceOffset, length) {
    stats.calls += 1
    stats.uploadBytes += length * data.BYTES_PER_ELEMENT
  }
  gl.texSubImage3D = function recordAtlas(target, level, x, y, z, width, height, depth) {
    stats.calls += 1
    stats.uploadBytes += width * height * depth
  }
  gl.drawArraysInstanced = function recordDraw(mode, first, count, instances) {
    stats.calls += 1
    stats.draws += 1
    stats.instances += instances
  }
  return { gl, stats }
}
