const std = @import("std");

pub fn recordsEqual(comptime count: usize, a: *const [count]f32, b: *const [count]f32) bool {
    comptime std.debug.assert(count % 2 == 0);
    const left: *align(4) const [count / 2]u64 = @ptrCast(a);
    const right: *align(4) const [count / 2]u64 = @ptrCast(b);
    for (0..count / 2) |i| if (left[i] != right[i]) return false;
    return true;
}

fn checkBits(comptime count: usize) !void {
    var left: [count]f32 = @splat(0);
    for (std.mem.asBytes(&left), 0..) |*byte, i| byte.* = @truncate(i * 37 + 11);
    var right = left;
    try std.testing.expect(recordsEqual(count, &left, &right));
    const bytes = std.mem.asBytes(&right);
    for (0..bytes.len) |i| {
        bytes[i] ^= 1;
        try std.testing.expect(!recordsEqual(count, &left, &right));
        bytes[i] ^= 1;
    }
    left[0] = @bitCast(@as(u32, 0x7fc00001));
    right = left;
    try std.testing.expect(recordsEqual(count, &left, &right));
    right[0] = @bitCast(@as(u32, 0x7fc00002));
    try std.testing.expect(!recordsEqual(count, &left, &right));
    left[0] = 0;
    right = left;
    right[0] = @bitCast(@as(u32, 0x80000000));
    try std.testing.expect(!recordsEqual(count, &left, &right));
}

test "cell and glyph records compare every byte" {
    try checkBits(16);
    try checkBits(24);
}

test "record comparison accepts four-byte alignment" {
    var left_storage: [17]u32 align(8) = @splat(0);
    var right_storage: [17]u32 align(8) = @splat(0);
    const left: *[16]f32 = @ptrCast(&left_storage[1]);
    const right: *[16]f32 = @ptrCast(&right_storage[1]);
    try std.testing.expect(@intFromPtr(left) % 8 == 4);
    try std.testing.expect(recordsEqual(16, left, right));
    right_storage[16] = 1;
    try std.testing.expect(!recordsEqual(16, left, right));
}
