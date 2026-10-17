import { colorFunctions, cellCoverageFunctions } from './composition.wgsl.js'
import { rowRemapShader } from './row-remap.wgsl.js'

export const cellShader = /* wgsl */ `
const FLAG_CURSOR: u32 = 1u;
const FLAG_OVERLINE: u32 = 2u;
const FLAG_STRIKETHROUGH: u32 = 4u;

struct Instance {
  rect: vec4f,
  foreground: vec4f,
  background: vec4f,
  metadata: vec4f,
}

struct Viewport {
  size: vec2f,
  columns: u32,
  rowHeight: f32,
  rowOffset: u32,
  instanceCount: u32,
  padding: vec2u,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) foreground: vec4f,
  @location(1) background: vec4f,
  @location(2) metadata: vec4f,
  @location(3) local: vec2f,
  @location(4) size: vec2f,
}

@group(0) @binding(0) var<storage, read> instances: array<Instance>;
@group(0) @binding(1) var<uniform> viewport: Viewport;

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOutput {
  let corners = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
  );
${rowRemapShader}
  let corner = corners[vertexIndex];
  let local = corner * instance.rect.zw;
  let pixel = origin + local;
  var output: VertexOutput;
  output.position = vec4f(
    pixel.x / viewport.size.x * 2.0 - 1.0,
    1.0 - pixel.y / viewport.size.y * 2.0,
    0.0,
    1.0,
  );
  output.foreground = instance.foreground;
  output.background = instance.background;
  output.metadata = instance.metadata;
  output.local = local;
  output.size = instance.rect.zw;
  return output;
}

${colorFunctions}
${cellCoverageFunctions}
@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let flags = u32(input.metadata.x);
  let underline = u32(input.metadata.y);
  let cursorStyle = u32(input.metadata.z);
  let minimumContrast = input.metadata.w;
  let decoration = decorationCoverage(flags, underline, input.local, input.size);
  let cursor = cursorCoverage(flags, cursorStyle, input.local, input.size);
  let effectAlpha = max(decoration, cursor) * input.foreground.a;
  let adjusted = contrastColor(input.foreground.rgb, input.background.rgb, minimumContrast);
  let background = vec4f(input.background.rgb * input.background.a, input.background.a);
  let effect = vec4f(adjusted * effectAlpha, effectAlpha);
  return effect + background * (1.0 - effectAlpha);
}
`
