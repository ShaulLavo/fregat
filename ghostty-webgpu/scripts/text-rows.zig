const std = @import("std");
const c = @cImport({
    @cInclude("ghostty/vt/render.h");
    @cInclude("ghostty/vt/screen.h");
});

extern "env" fn ghostty_wasm_alloc(len: usize) ?[*]u8;
extern "env" fn ghostty_wasm_free(ptr: ?[*]u8, len: usize) void;

const TextRow = extern struct { y: u32, start: u32, len: u32, source: u32 };
const TextCell = extern struct { codepoint: u32, grapheme_start: u32, grapheme_len: u32 };
const TextSnapshot = extern struct {
    rows: [*]TextRow,
    rows_cap: u32,
    rows_len: u32,
    cells: [*]TextCell,
    cells_cap: u32,
    cells_len: u32,
    graphemes: [*]u32,
    graphemes_cap: u32,
    graphemes_len: u32,
    codepoint_mask: u32,
};
const CachedRow = struct {
    id: c.GhosttyRenderStateRowId = std.mem.zeroes(c.GhosttyRenderStateRowId),
    raw: [*]c.GhosttyCell,
    cells: [*]TextCell,
    graphemes: ?[*]u32 = null,
    capacity: u32 = 0,
    grapheme_count: u32 = 0,
    payload_valid: bool = false,
};
const PendingRow = struct { id: c.GhosttyRenderStateRowId, raw: c.GhosttyCellsView };
const Cache = struct {
    columns: u32,
    rows: u32,
    length: u32 = 0,
    previous: [*]CachedRow,
    next: [*]CachedRow,
    pending: [*]PendingRow,
    used: [*]bool,
    raw: [*]c.GhosttyCell,
    cells: [*]TextCell,
    scratch: ?[*]u32 = null,
    capacity: u32 = 0,
};

fn allocate(comptime T: type, count: usize) ?[*]T {
    const memory = ghostty_wasm_alloc(@max(count, 1) * @sizeOf(T)) orelse return null;
    return @ptrCast(@alignCast(memory));
}

fn free(comptime T: type, memory: [*]T, count: usize) void {
    ghostty_wasm_free(@ptrCast(memory), @max(count, 1) * @sizeOf(T));
}

fn create(columns: u32, rows: u32) error{OutOfMemory}!*Cache {
    const cache = allocate(Cache, 1) orelse return error.OutOfMemory;
    errdefer free(Cache, cache, 1);
    const previous = allocate(CachedRow, rows) orelse return error.OutOfMemory;
    errdefer free(CachedRow, previous, rows);
    const next = allocate(CachedRow, rows) orelse return error.OutOfMemory;
    errdefer free(CachedRow, next, rows);
    const pending = allocate(PendingRow, rows) orelse return error.OutOfMemory;
    errdefer free(PendingRow, pending, rows);
    const used = allocate(bool, rows) orelse return error.OutOfMemory;
    errdefer free(bool, used, rows);
    const raw = allocate(c.GhosttyCell, columns * rows) orelse return error.OutOfMemory;
    errdefer free(c.GhosttyCell, raw, columns * rows);
    const cells = allocate(TextCell, columns * rows) orelse return error.OutOfMemory;
    for (0..rows) |y| previous[y] = .{ .raw = raw + y * columns, .cells = cells + y * columns };
    cache[0] = .{ .columns = columns, .rows = rows, .previous = previous, .next = next, .pending = pending, .used = used, .raw = raw, .cells = cells };
    return &cache[0];
}

pub fn createCache(columns: u32, rows: u32) callconv(.c) ?*Cache {
    return create(columns, rows) catch null;
}

pub fn destroyCache(cache: *Cache) callconv(.c) void {
    for (cache.previous[0..cache.rows]) |row| if (row.graphemes) |pool| free(u32, pool, row.capacity);
    if (cache.scratch) |scratch| free(u32, scratch, cache.capacity);
    free(CachedRow, cache.previous, cache.rows);
    free(CachedRow, cache.next, cache.rows);
    free(PendingRow, cache.pending, cache.rows);
    free(bool, cache.used, cache.rows);
    free(c.GhosttyCell, cache.raw, cache.columns * cache.rows);
    free(TextCell, cache.cells, cache.columns * cache.rows);
    free(Cache, @as([*]Cache, @ptrCast(cache)), 1);
}

fn reserve(pointer: *?[*]u32, capacity: *u32, length: u32) c.GhosttyResult {
    if (length <= capacity.*) return c.GHOSTTY_SUCCESS;
    const memory = allocate(u32, length) orelse return c.GHOSTTY_OUT_OF_MEMORY;
    if (pointer.*) |old| free(u32, old, capacity.*);
    pointer.* = memory;
    capacity.* = length;
    return c.GHOSTTY_SUCCESS;
}

fn matching(cache: *Cache, row: *const CachedRow, raw: c.GhosttyCellsView, iterator: c.GhosttyRenderStateRowIterator, cells: *c.GhosttyRenderStateRowCells, matches: *bool) c.GhosttyResult {
    matches.* = false;
    if (!std.mem.eql(c.GhosttyCell, raw.ptr[0..raw.len], row.raw[0..raw.len])) return c.GHOSTTY_SUCCESS;
    if (row.grapheme_count == 0) {
        matches.* = true;
        return c.GHOSTTY_SUCCESS;
    }
    var selected = false;
    for (row.cells[0..raw.len], 0..) |cell, x| {
        if (cell.grapheme_len == 0) continue;
        if (!selected) {
            const result = c.ghostty_render_state_row_get(iterator, c.GHOSTTY_RENDER_STATE_ROW_DATA_CELLS, @ptrCast(cells));
            if (result != c.GHOSTTY_SUCCESS) return result;
            selected = true;
        }
        var result = c.ghostty_render_state_row_cells_select(cells.*, @intCast(x));
        if (result != c.GHOSTTY_SUCCESS) return result;
        var length: u32 = 0;
        result = c.ghostty_render_state_row_cells_get(cells.*, c.GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_LEN, &length);
        if (result != c.GHOSTTY_SUCCESS) return result;
        if (length != cell.grapheme_len) return c.GHOSTTY_SUCCESS;
        result = reserve(&cache.scratch, &cache.capacity, length);
        if (result != c.GHOSTTY_SUCCESS) return result;
        result = c.ghostty_render_state_row_cells_get(cells.*, c.GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_BUF, cache.scratch.?);
        if (result != c.GHOSTTY_SUCCESS) return result;
        const old = row.graphemes.? + cell.grapheme_start;
        if (!std.mem.eql(u32, cache.scratch.?[0..length], old[0..length])) return c.GHOSTTY_SUCCESS;
    }
    matches.* = true;
    return c.GHOSTTY_SUCCESS;
}

fn readCell(raw: c.GhosttyCell, cells: c.GhosttyRenderStateRowCells, x: u32, out: *TextCell, text: *TextSnapshot) c.GhosttyResult {
    out.* = .{ .codepoint = 0, .grapheme_start = 0, .grapheme_len = 0 };
    var wide: c.GhosttyCellWide = 0;
    var result = c.ghostty_cell_get(raw, c.GHOSTTY_CELL_DATA_CODEPOINT, &out.codepoint);
    if (result != c.GHOSTTY_SUCCESS) return result;
    result = c.ghostty_cell_get(raw, c.GHOSTTY_CELL_DATA_WIDE, &wide);
    if (result != c.GHOSTTY_SUCCESS) return result;
    if (wide == c.GHOSTTY_CELL_WIDE_SPACER_TAIL) out.codepoint |= 0x80000000;
    text.codepoint_mask |= out.codepoint;
    var tag: c.GhosttyCellContentTag = 0;
    result = c.ghostty_cell_get(raw, c.GHOSTTY_CELL_DATA_CONTENT_TAG, &tag);
    if (result != c.GHOSTTY_SUCCESS) return result;
    if (tag != c.GHOSTTY_CELL_CONTENT_CODEPOINT_GRAPHEME) return c.GHOSTTY_SUCCESS;
    result = c.ghostty_render_state_row_cells_select(cells, @intCast(x));
    if (result != c.GHOSTTY_SUCCESS) return result;
    result = c.ghostty_render_state_row_cells_get(cells, c.GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_LEN, &out.grapheme_len);
    if (result != c.GHOSTTY_SUCCESS) return result;
    out.grapheme_start = text.graphemes_len;
    text.graphemes_len += out.grapheme_len;
    if (text.graphemes_len > text.graphemes_cap) return c.GHOSTTY_SUCCESS;
    return c.ghostty_render_state_row_cells_get(cells, c.GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_BUF, text.graphemes + out.grapheme_start);
}

fn readRow(iterator: c.GhosttyRenderStateRowIterator, cells: *c.GhosttyRenderStateRowCells, raw: c.GhosttyCellsView, text: *TextSnapshot) c.GhosttyResult {
    if (text.cells_len + raw.len > text.cells_cap) return c.GHOSTTY_OUT_OF_SPACE;
    var result = c.ghostty_render_state_row_get(iterator, c.GHOSTTY_RENDER_STATE_ROW_DATA_CELLS, @ptrCast(cells));
    if (result != c.GHOSTTY_SUCCESS) return result;
    for (0..raw.len) |x| {
        result = readCell(raw.ptr[x], cells.*, @intCast(x), &text.cells[text.cells_len], text);
        if (result != c.GHOSTTY_SUCCESS) return result;
        text.cells_len += 1;
    }
    return c.GHOSTTY_SUCCESS;
}

fn reuseRow(cache: *Cache, pending: PendingRow, iterator: c.GhosttyRenderStateRowIterator, cells: *c.GhosttyRenderStateRowCells, row: *TextRow, known_identity: *bool) c.GhosttyResult {
    known_identity.* = false;
    for (0..cache.length) |source| {
        const previous = &cache.previous[source];
        if (cache.used[source] or !std.mem.eql(u64, &pending.id.bits, &previous.id.bits)) continue;
        known_identity.* = true;
        if (!previous.payload_valid) return c.GHOSTTY_SUCCESS;
        var matches = false;
        const result = matching(cache, previous, pending.raw, iterator, cells, &matches);
        if (result != c.GHOSTTY_SUCCESS) return result;
        if (!matches) return c.GHOSTTY_SUCCESS;
        row.source = @intCast(source + 1);
        cache.used[source] = true;
        return c.GHOSTTY_SUCCESS;
    }
    return c.GHOSTTY_SUCCESS;
}

fn commit(cache: *Cache, text: *TextSnapshot, retain_payloads: bool) c.GhosttyResult {
    var length: u32 = text.rows_len;
    for (text.rows[0..text.rows_len], 0..) |row, index| {
        if (row.source != 0) {
            cache.next[index] = cache.previous[row.source - 1];
            continue;
        }
        const slot = std.mem.indexOfScalar(bool, cache.used[0..cache.rows], false) orelse return c.GHOSTTY_OUT_OF_SPACE;
        cache.used[slot] = true;
        var stored = cache.previous[slot];
        stored.id = cache.pending[index].id;
        stored.payload_valid = retain_payloads;
        if (!retain_payloads) {
            cache.next[index] = stored;
            continue;
        }
        var pool_length: u32 = 0;
        for (text.cells[row.start .. row.start + row.len]) |cell| pool_length += cell.grapheme_len;
        stored.grapheme_count = pool_length;
        const result = reserve(&stored.graphemes, &stored.capacity, pool_length);
        cache.previous[slot].graphemes = stored.graphemes;
        cache.previous[slot].capacity = stored.capacity;
        if (result != c.GHOSTTY_SUCCESS) {
            cache.length = 0;
            return result;
        }
        @memcpy(stored.raw[0..row.len], cache.pending[index].raw.ptr[0..row.len]);
        @memcpy(stored.cells[0..row.len], text.cells[row.start .. row.start + row.len]);
        var offset: u32 = 0;
        for (stored.cells[0..row.len]) |*cell| {
            if (cell.grapheme_len == 0) continue;
            @memcpy(stored.graphemes.?[offset .. offset + cell.grapheme_len], text.graphemes[cell.grapheme_start .. cell.grapheme_start + cell.grapheme_len]);
            cell.grapheme_start = offset;
            offset += cell.grapheme_len;
        }
        cache.next[index] = stored;
    }
    for (cache.used[0..cache.rows], 0..) |used, index| {
        if (used) continue;
        cache.next[length] = cache.previous[index];
        length += 1;
    }
    const previous = cache.previous;
    cache.previous = cache.next;
    cache.next = previous;
    cache.length = text.rows_len;
    return c.GHOSTTY_SUCCESS;
}

pub fn readRows(state: c.GhosttyRenderState, iterator: c.GhosttyRenderStateRowIterator, cells: c.GhosttyRenderStateRowCells, mask: ?[*]const u8, mask_len: u32, dirty_only: bool, text: *TextSnapshot, cache: *Cache) callconv(.c) c.GhosttyResult {
    text.rows_len = 0;
    text.cells_len = 0;
    text.graphemes_len = 0;
    text.codepoint_mask = 0;
    @memset(cache.used[0..cache.rows], false);
    var it = iterator;
    var row_cells = cells;
    var result = c.ghostty_render_state_get(state, c.GHOSTTY_RENDER_STATE_DATA_ROW_ITERATOR, @ptrCast(&it));
    if (result != c.GHOSTTY_SUCCESS) return result;
    var y: u32 = 0;
    var retain_payloads = true;
    while (c.ghostty_render_state_row_iterator_next(it)) : (y += 1) {
        if (mask) |m| {
            if (y >= mask_len or m[y] == 0) continue;
        }
        if (dirty_only) {
            var dirty = false;
            result = c.ghostty_render_state_row_get(it, c.GHOSTTY_RENDER_STATE_ROW_DATA_DIRTY, &dirty);
            if (result != c.GHOSTTY_SUCCESS) return result;
            if (!dirty) continue;
        }
        if (text.rows_len >= text.rows_cap or text.rows_len >= cache.rows) return c.GHOSTTY_OUT_OF_SPACE;
        var pending: PendingRow = undefined;
        result = c.ghostty_render_state_row_get(it, c.GHOSTTY_RENDER_STATE_ROW_DATA_CELLS_RAW, &pending.raw);
        if (result != c.GHOSTTY_SUCCESS) return result;
        if (pending.raw.len != cache.columns) return c.GHOSTTY_OUT_OF_SPACE;
        result = c.ghostty_render_state_row_get(it, c.GHOSTTY_RENDER_STATE_ROW_DATA_ID, &pending.id);
        if (result != c.GHOSTTY_SUCCESS) return result;
        var row: TextRow = .{ .y = y, .start = text.cells_len, .len = pending.raw.len, .source = 0 };
        var known_identity = false;
        if (retain_payloads) {
            result = reuseRow(cache, pending, it, &row_cells, &row, &known_identity);
            if (result != c.GHOSTTY_SUCCESS) return result;
        }
        // A new leading row may make caching unprofitable; ids seed the next read safely.
        if (text.rows_len == 0 and cache.length != 0 and !known_identity) retain_payloads = false;
        if (row.source == 0) {
            result = readRow(it, &row_cells, pending.raw, text);
            if (result != c.GHOSTTY_SUCCESS) return result;
        }
        text.rows[text.rows_len] = row;
        cache.pending[text.rows_len] = pending;
        text.rows_len += 1;
    }
    if (text.graphemes_len > text.graphemes_cap) return c.GHOSTTY_OUT_OF_SPACE;
    return commit(cache, text, retain_payloads);
}
