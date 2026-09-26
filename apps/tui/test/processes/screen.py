import re
import unicodedata

CSI = re.compile(rb"\x1b\[([0-9;:?<>=]*)([ -/]*)([@-~])")
# Longer than any real control sequence: bytes that never close one are skipped.
MAX_SEQUENCE = 256
STRING_INTRODUCERS = b"]P_^X"


class Screen:
    """The grid a terminal shows after the bytes so far: cursor moves, text, erases, scrolling and
    the alternate screen. A diff-painting TUI skips cells that already hold the right character, so
    its text can only be read back from here, never matched in the byte stream."""

    def __init__(self, rows, cols):
        self.rows, self.cols = rows, cols
        self.grid = blank(rows, cols)
        self.saved = None
        self.row = 0
        self.col = 0
        self.pending = b""

    def resize(self, rows, cols):
        self.rows, self.cols = rows, cols
        self.grid = [(line + [" "] * cols)[:cols] for line in self.grid[:rows]]
        self.grid += blank(rows - len(self.grid), cols)
        self.row = min(self.row, rows - 1)
        self.col = min(self.col, cols - 1)

    def text(self):
        return "\n".join("".join(line) for line in self.grid)

    def feed(self, data):
        data = self.pending + data
        self.pending = b""
        index = 0
        while index < len(data):
            consumed = self.step(data, index)
            if consumed is None:
                self.pending = data[index:]
                return
            index += consumed

    def step(self, data, index):
        byte = data[index]
        if byte == 0x1B:
            return self.escape(data, index)
        if byte == 0x0D:
            self.col = 0
        elif byte == 0x0A:
            self.line_feed()
        elif byte == 0x08:
            self.col = max(self.col - 1, 0)
        elif byte >= 0x20:
            length = utf8_length(byte)
            if index + length > len(data):
                return None
            self.put(data[index : index + length].decode("utf-8", "replace"))
            return length
        return 1

    def line_feed(self):
        if self.row < self.rows - 1:
            self.row += 1
            return
        self.grid = self.grid[1:] + blank(1, self.cols)

    def put(self, char):
        width = 2 if unicodedata.east_asian_width(char) in "WF" else 1
        if self.col + width > self.cols:
            return
        self.grid[self.row][self.col] = char
        if width == 2:
            self.grid[self.row][self.col + 1] = ""
        self.col += width

    def escape(self, data, index):
        if index + 1 >= len(data):
            return None
        kind = data[index + 1]
        if kind == ord("["):
            match = CSI.match(data, index)
            if not match:
                return None if len(data) - index < MAX_SEQUENCE else 2
            self.csi(match.group(1), match.group(3)[0])
            return match.end() - index
        if kind in STRING_INTRODUCERS:
            length = string_length(data, index)
            return length if length or len(data) - index < MAX_SEQUENCE else 2
        if kind in b"()#%":
            return 3 if index + 2 < len(data) else None
        return 2

    def csi(self, raw, final):
        if raw.startswith(b"?"):
            self.private_mode(raw, final)
            return
        if raw[:1] in (b">", b"<", b"="):
            return
        params = [int(part.split(b":")[0] or 0) for part in raw.split(b";")] if raw else []
        count = (params[0] if params else 0) or 1
        if final in b"Hf":
            column = params[1] if len(params) > 1 and params[1] else 1
            self.move(count - 1, column - 1)
        elif final in b"ABCD":
            rows, cols = {b"A"[0]: (-count, 0), b"B"[0]: (count, 0), b"C"[0]: (0, count), b"D"[0]: (0, -count)}[final]
            self.move(self.row + rows, self.col + cols)
        elif final == ord("G"):
            self.move(self.row, count - 1)
        elif final == ord("d"):
            self.move(count - 1, self.col)
        elif final == ord("K"):
            self.erase_line(params[0] if params else 0)
        elif final == ord("J"):
            self.erase_display(params[0] if params else 0)
        elif final == ord("X"):
            self.clear(self.row, self.col, self.col + count)

    def private_mode(self, raw, final):
        if raw != b"?1049" or final not in b"hl":
            return
        if final == ord("h") and self.saved is None:
            self.saved = self.grid
            self.grid = blank(self.rows, self.cols)
        elif final == ord("l") and self.saved is not None:
            self.grid = [(line + [" "] * self.cols)[: self.cols] for line in self.saved[: self.rows]]
            self.grid += blank(self.rows - len(self.grid), self.cols)
            self.saved = None

    def move(self, row, col):
        self.row = max(0, min(row, self.rows - 1))
        self.col = max(0, min(col, self.cols - 1))

    def clear(self, row, start, end):
        for col in range(max(start, 0), min(end, self.cols)):
            self.grid[row][col] = " "

    def erase_line(self, mode):
        start, end = {0: (self.col, self.cols), 1: (0, self.col + 1)}.get(mode, (0, self.cols))
        self.clear(self.row, start, end)

    def erase_display(self, mode):
        if mode in (2, 3):
            self.grid = blank(self.rows, self.cols)
            return
        rows = range(self.row + 1, self.rows) if mode == 0 else range(0, self.row)
        self.erase_line(mode)
        for row in rows:
            self.clear(row, 0, self.cols)


def blank(rows, cols):
    return [[" "] * cols for _ in range(max(rows, 0))]


def string_length(data, index):
    ends = [end + 1 for end in [data.find(b"\x07", index)] if end >= 0]
    ends += [end + 2 for end in [data.find(b"\x1b\\", index + 2)] if end >= 0]
    return min(ends) - index if ends else None


def utf8_length(byte):
    if byte >> 5 == 0b110:
        return 2
    if byte >> 4 == 0b1110:
        return 3
    if byte >> 3 == 0b11110:
        return 4
    return 1
