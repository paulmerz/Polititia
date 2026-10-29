// Advance widths read from a TrueType file, so the share cards can wrap text
// before resvg draws it (SVG has no line wrapping). Kerning is ignored: lines
// come out a few pixels wider than measured, never narrower.

type Table = { offset: number; length: number };

export class FontMetrics {
  private readonly view: DataView;
  private readonly unitsPerEm: number;
  private readonly advances: number[];
  private readonly glyphOf: (codePoint: number) => number;

  constructor(buffer: Uint8Array) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const tables = this.tables();
    const head = this.require(tables, "head");
    const hhea = this.require(tables, "hhea");
    const hmtx = this.require(tables, "hmtx");
    const maxp = this.require(tables, "maxp");
    this.unitsPerEm = this.view.getUint16(head.offset + 18);
    const metricCount = this.view.getUint16(hhea.offset + 34);
    const glyphCount = this.view.getUint16(maxp.offset + 4);
    this.advances = [];
    for (let index = 0; index < glyphCount; index += 1) {
      const record = Math.min(index, metricCount - 1);
      this.advances.push(this.view.getUint16(hmtx.offset + record * 4));
    }
    this.glyphOf = this.readCmap(this.require(tables, "cmap"));
  }

  width(text: string, size: number): number {
    let units = 0;
    for (const char of text) {
      units += this.advances[this.glyphOf(char.codePointAt(0) || 0)] || 0;
    }
    return (units * size) / this.unitsPerEm;
  }

  private tables(): Map<string, Table> {
    const count = this.view.getUint16(4);
    const tables = new Map<string, Table>();
    for (let index = 0; index < count; index += 1) {
      const record = 12 + index * 16;
      const tag = String.fromCharCode(...[0, 1, 2, 3].map((byte) => this.view.getUint8(record + byte)));
      tables.set(tag, { offset: this.view.getUint32(record + 8), length: this.view.getUint32(record + 12) });
    }
    return tables;
  }

  private require(tables: Map<string, Table>, tag: string): Table {
    const table = tables.get(tag);
    if (!table) {
      throw new Error(`Font has no ${tag} table.`);
    }
    return table;
  }

  // Unicode subtables only: format 12 (full range) first, else format 4 (BMP).
  private readCmap(cmap: Table): (codePoint: number) => number {
    const view = this.view;
    const count = view.getUint16(cmap.offset + 2);
    const subtables: Array<{ format: number; offset: number }> = [];
    for (let index = 0; index < count; index += 1) {
      const record = cmap.offset + 4 + index * 8;
      const platform = view.getUint16(record);
      const encoding = view.getUint16(record + 2);
      const offset = cmap.offset + view.getUint32(record + 4);
      if (platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))) {
        subtables.push({ format: view.getUint16(offset), offset });
      }
    }
    const full = subtables.find((table) => table.format === 12);
    if (full) {
      const groups = view.getUint32(full.offset + 12);
      return (codePoint) => {
        for (let index = 0; index < groups; index += 1) {
          const group = full.offset + 16 + index * 12;
          const start = view.getUint32(group);
          if (codePoint >= start && codePoint <= view.getUint32(group + 4)) {
            return view.getUint32(group + 8) + codePoint - start;
          }
        }
        return 0;
      };
    }
    const bmp = subtables.find((table) => table.format === 4);
    if (!bmp) {
      throw new Error("Font has no Unicode cmap.");
    }
    const segments = view.getUint16(bmp.offset + 6) / 2;
    const ends = bmp.offset + 14;
    const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2;
    const ranges = deltas + segments * 2;
    return (codePoint) => {
      for (let index = 0; index < segments; index += 1) {
        if (codePoint > view.getUint16(ends + index * 2)) {
          continue;
        }
        const start = view.getUint16(starts + index * 2);
        if (codePoint < start) {
          return 0;
        }
        const delta = view.getInt16(deltas + index * 2);
        const rangeOffset = view.getUint16(ranges + index * 2);
        if (!rangeOffset) {
          return (codePoint + delta) & 0xffff;
        }
        const glyph = view.getUint16(ranges + index * 2 + rangeOffset + (codePoint - start) * 2);
        return glyph ? (glyph + delta) & 0xffff : 0;
      }
      return 0;
    };
  }
}

// Greedy wrapping on spaces. Returns null when the text needs more than
// `maxLines` lines, so the caller can try a smaller size.
export function wrapText(font: FontMetrics, text: string, size: number, maxWidth: number, maxLines: number): string[] | null {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.width(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) {
      lines.push(line);
    }
    if (font.width(word, size) > maxWidth) {
      return null;
    }
    line = word;
  }
  if (line) {
    lines.push(line);
  }
  return lines.length <= maxLines ? lines : null;
}

// The largest size in `sizes` at which `text` fits, else the smallest size,
// cut with an ellipsis.
export function fitText(
  font: FontMetrics,
  text: string,
  sizes: number[],
  maxWidth: number,
  maxLines: number,
): { size: number; lines: string[] } {
  for (const size of sizes) {
    const lines = wrapText(font, text, size, maxWidth, maxLines);
    if (lines) {
      return { size, lines };
    }
  }
  const size = sizes[sizes.length - 1];
  const words = text.split(/\s+/).filter(Boolean);
  while (words.length > 1) {
    words.pop();
    const lines = wrapText(font, `${words.join(" ")} …`, size, maxWidth, maxLines);
    if (lines) {
      return { size, lines };
    }
  }
  let single = words[0] || "";
  while (single.length > 1 && font.width(`${single}…`, size) > maxWidth) {
    single = single.slice(0, -1);
  }
  return { size, lines: [`${single}…`] };
}
