import Foundation

/// Deterministic corpora. The LCG is the same one the web benches use
/// (`editor/packages/editor/bench/pieceTable-walker.ts`,
/// `apps/web/scripts/generate-bench-fixture.ts`) so a fixture generated on
/// either side is the same document.
struct BenchRandom {
  private var state: UInt32

  init(seed: UInt32) {
    state = seed
  }

  mutating func next() -> Double {
    state = state &* 1_664_525 &+ 1_013_904_223
    return Double(state) / Double(UInt32.max) / 1.0000000002328306
  }

  mutating func next(below bound: Int) -> Int {
    Int(next() * Double(bound))
  }
}

enum Corpus {
  /// Roughly source-shaped text at a requested byte size. Line lengths vary so
  /// a scan cannot be strength-reduced into a fixed stride, and every line is
  /// ASCII so the Character path has no excuse — grapheme breaking is the cost
  /// even when there is nothing to break.
  static func source(bytes target: Int, seed: UInt32 = 0x5EED) -> String {
    var random = BenchRandom(seed: seed)
    var text = ""
    text.reserveCapacity(target + 128)

    var line = 0
    while text.utf8.count < target {
      let indent = String(repeating: "  ", count: random.next(below: 4))
      let padding = String(repeating: "x", count: random.next(below: 60))
      text += "\(indent)const value\(line) = compute(input\(line)) + offset  // \(padding)\n"
      line += 1
    }

    return text
  }
}
