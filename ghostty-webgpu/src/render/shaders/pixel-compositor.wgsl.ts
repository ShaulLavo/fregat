import { cellCoverageFunctions, colorFunctions } from './composition.wgsl.js'

const fullscreenVertex = /* wgsl */ `
@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(positions[index], 0.0, 1.0);
}
`

const composition = /* wgsl */ `
const FLAG_CURSOR: u32 = 1u;
const FLAG_OVERLINE: u32 = 2u;
const FLAG_STRIKETHROUGH: u32 = 4u;
const FLAG_GLYPH: u32 = 1u;

struct Cell {
  rect: vec4f,
  foreground: vec4f,
  background: vec4f,
  metadata: vec4f,
}

struct Glyph {
  rect: vec4f,
  color: vec4f,
  uv: vec4f,
  background: vec4f,
  metadata: vec4f,
  atlas: vec4f,
}

struct Viewport {
  size: vec2f,
  columns: u32,
  rowHeight: f32,
  rowOffset: u32,
  instanceCount: u32,
  padding: vec2u,
  grid: vec2u,
  cellSize: vec2f,
  reach: vec4f,
}

@group(0) @binding(0) var<storage, read> cells: array<Cell>;
@group(0) @binding(1) var<storage, read> glyphs: array<Glyph>;
@group(0) @binding(2) var<uniform> viewport: Viewport;
@group(0) @binding(3) var atlasSampler: sampler;
@group(0) @binding(4) var grayscaleAtlas: texture_2d_array<f32>;
@group(0) @binding(5) var colorAtlas: texture_2d_array<f32>;

${colorFunctions}
${cellCoverageFunctions}

fn physicalIndex(logical: vec2u) -> u32 {
  let index = logical.y * viewport.grid.x + logical.x;
  if (viewport.columns == 0u) { return index; }
  return (index + viewport.rowOffset * viewport.columns) % viewport.instanceCount;
}

fn originFor(rect: vec4f, row: u32) -> vec2f {
  if (viewport.columns == 0u) { return rect.xy; }
  return rect.xy + vec2f(0.0, f32(row) * viewport.rowHeight);
}

fn contains(local: vec2f, size: vec2f) -> bool {
  return all(local >= vec2f(0.0)) && all(local < size);
}

// The instanced unorm attachment stores the result after every source-over blend.
fn quantized(color: vec4f) -> vec4f {
  return round(clamp(color, vec4f(0.0), vec4f(1.0)) * 255.0) / 255.0;
}

fn cellPixel(pixel: vec2f, logical: vec2u) -> vec4f {
  let cell = cells[physicalIndex(logical)];
  let local = pixel - originFor(cell.rect, logical.y);
  if (!contains(local, cell.rect.zw)) { return vec4f(0.0); }
  let flags = u32(cell.metadata.x);
  let decoration = decorationCoverage(flags, u32(cell.metadata.y), local, cell.rect.zw);
  let cursor = cursorCoverage(flags, u32(cell.metadata.z), local, cell.rect.zw);
  let alpha = max(decoration, cursor) * cell.foreground.a;
  let adjusted = contrastColor(cell.foreground.rgb, cell.background.rgb, cell.metadata.w);
  let background = vec4f(cell.background.rgb * cell.background.a, cell.background.a);
  return quantized(vec4f(adjusted * alpha, alpha) + background * (1.0 - alpha));
}

fn glyphPixel(pixel: vec2f, logical: vec2u) -> vec4f {
  let glyph = glyphs[physicalIndex(logical)];
  if (!hasFlag(u32(glyph.metadata.x), FLAG_GLYPH)) { return vec4f(0.0); }
  let local = pixel - originFor(glyph.rect, logical.y);
  if (!contains(local, glyph.rect.zw)) { return vec4f(0.0); }
  let uv = mix(glyph.uv.xy, glyph.uv.zw, local / glyph.rect.zw);
  let layer = i32(glyph.atlas.x);
  let colorGlyph = glyph.atlas.z >= 0.5;
  let adjusted = contrastColor(glyph.color.rgb, glyph.background.rgb, glyph.metadata.z);
  if (colorGlyph) {
    let color = textureSampleLevel(colorAtlas, atlasSampler, uv, layer, 0.0);
    let alpha = color.a * glyph.color.a;
    return vec4f(color.rgb * alpha, alpha);
  }
  let coverage = textureSampleLevel(grayscaleAtlas, atlasSampler, uv, layer, 0.0).r;
  let alpha = coverage * glyph.color.a;
  return vec4f(adjusted * alpha, alpha);
}

fn composeRow(pixel: vec2f, row: u32, first: u32, last: u32, initial: vec4f) -> vec4f {
  var result = initial;
  for (var column = first; column <= last; column += 1u) {
    let glyph = glyphPixel(pixel, vec2u(column, row));
    result = quantized(glyph + result * (1.0 - glyph.a));
  }
  return result;
}

fn composePixel(pixel: vec2f) -> vec4f {
  let logical = min(vec2u(pixel / viewport.cellSize), viewport.grid - vec2u(1u));
  var result = cellPixel(pixel, logical);
  if (all(viewport.reach == vec4f(0.0, 0.0, viewport.cellSize))) {
    let glyph = glyphPixel(pixel, logical);
    return quantized(glyph + result * (1.0 - glyph.a));
  }
  let limit = vec2i(viewport.grid) - vec2i(1);
  let first = vec2u(clamp(vec2i(ceil((pixel - viewport.reach.zw) / viewport.cellSize)), vec2i(0), limit));
  let last = vec2u(clamp(vec2i(floor((pixel - viewport.reach.xy) / viewport.cellSize)), vec2i(0), limit));
  for (var row = first.y; row <= last.y; row += 1u) {
    result = composeRow(pixel, row, first.x, last.x, result);
  }
  return result;
}
`

export const fullscreenCompositorShader =
  composition +
  fullscreenVertex +
  /* wgsl */ `
@fragment
fn fragmentMain(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
  return composePixel(pixel.xy);
}
`

export const computeCompositorShader =
  composition +
  /* wgsl */ `
@group(0) @binding(6) var output: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn computeMain(@builtin(global_invocation_id) pixel: vec3u) {
  if (any(pixel.xy >= vec2u(viewport.size))) { return; }
  textureStore(output, pixel.xy, composePixel(vec2f(pixel.xy) + vec2f(0.5)));
}
`

export const compositorPresentationShader =
  fullscreenVertex +
  /* wgsl */ `
@group(0) @binding(0) var pixels: texture_2d<f32>;

@fragment
fn fragmentMain(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
  return textureLoad(pixels, vec2i(pixel.xy), 0);
}
`

export function copyComputeCompositorShader(format: 'rgba8unorm' | 'bgra8unorm'): string {
  return (
    composition +
    /* wgsl */ `
@group(0) @binding(6) var output: texture_storage_2d<${format}, write>;
@group(0) @binding(7) var<storage, read> bands: array<u32>;

@compute @workgroup_size(8, 8)
fn computeMain(
  @builtin(workgroup_id) group: vec3u,
  @builtin(local_invocation_id) local: vec3u,
) {
  let pixel = vec2u(group.x * 8u + local.x, bands[group.y] * 8u + local.y);
  if (any(pixel >= vec2u(viewport.size))) { return; }
  textureStore(output, pixel, composePixel(vec2f(pixel) + vec2f(0.5)));
}
`
  )
}
