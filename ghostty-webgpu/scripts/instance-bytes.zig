const std = @import("std");

pub fn equal(comptime length: usize, left: *const [length]f32, right: *const [length]f32) bool {
    comptime std.debug.assert(length % 2 == 0);
    // Preserve float object bits, including signed zero, using legal unaligned wasm loads.
    const left_words: *align(4) const [length / 2]u64 = @ptrCast(left);
    const right_words: *align(4) const [length / 2]u64 = @ptrCast(right);
    for (left_words, right_words) |a, b| {
        if (a != b) return false;
    }
    return true;
}

test "instance equality preserves every float bit" {
    inline for (.{ 16, 24 }) |length| {
        var left: [length]f32 = @splat(0);
        var right = left;
        try std.testing.expect(equal(length, &left, &right));
        for (0..length * 4) |byte| {
            const bytes = std.mem.asBytes(&right);
            bytes[byte] = 1;
            try std.testing.expect(!equal(length, &left, &right));
            bytes[byte] = 0;
        }
        right[0] = @bitCast(@as(u32, 0x80000000));
        try std.testing.expect(!equal(length, &left, &right));
        left[0] = @bitCast(@as(u32, 0x7fc00001));
        right[0] = left[0];
        try std.testing.expect(equal(length, &left, &right));
        right[0] = @bitCast(@as(u32, 0x7fc00002));
        try std.testing.expect(!equal(length, &left, &right));
    }
}
