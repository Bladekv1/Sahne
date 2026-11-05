const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}

function mul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function rs(data, eccLen) {
  let gen = [1];
  for (let i = 0; i < eccLen; i += 1) {
    const next = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j += 1) {
      next[j] ^= gen[j];
      next[j + 1] ^= mul(gen[j], EXP[i]);
    }
    gen = next;
  }
  const out = new Uint8Array(data.length + eccLen);
  out.set(data);
  for (let i = 0; i < data.length; i += 1) {
    const factor = out[i];
    if (!factor) continue;
    for (let j = 0; j < gen.length; j += 1) out[i + j] ^= mul(gen[j], factor);
  }
  return out.slice(data.length);
}

const VERSIONS = {
  4: { size: 33, data: 80, ecc: 20, align: [6, 26] },
  5: { size: 37, data: 108, ecc: 26, align: [6, 30] },
};

function bytesOf(text, capacity) {
  const raw = new TextEncoder().encode(text).slice(0, capacity - 2);
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };
  push(0b0100, 4);
  push(raw.length, 8);
  for (const byte of raw) push(byte, 8);
  const limit = capacity * 8;
  for (let i = 0; i < Math.min(4, limit - bits.length); i += 1) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) value = (value << 1) | bits[i + j];
    data.push(value);
  }
  const pads = [0xec, 0x11];
  let pad = 0;
  while (data.length < capacity) data.push(pads[pad % 2]), pad += 1;
  return new Uint8Array(data);
}

function inFinder(x, y, size) {
  const hit = (ox, oy) => x >= ox && x < ox + 7 && y >= oy && y < oy + 7;
  return hit(0, 0) || hit(size - 7, 0) || hit(0, size - 7);
}

export function qrMatrix(text) {
  const version = new TextEncoder().encode(text).length <= 76 ? 4 : 5;
  const spec = VERSIONS[version];
  const data = bytesOf(text, spec.data);
  const code = new Uint8Array(spec.data + spec.ecc);
  code.set(data);
  code.set(rs(data, spec.ecc), spec.data);
  const n = spec.size;
  const grid = Array.from({ length: n }, () => Array(n).fill(null));
  const reserved = Array.from({ length: n }, () => Array(n).fill(false));
  const set = (x, y, value) => {
    if (x < 0 || y < 0 || x >= n || y >= n || grid[y][x] != null) return;
    grid[y][x] = value;
    reserved[y][x] = true;
  };
  const finder = (ox, oy) => {
    for (let y = -1; y <= 7; y += 1) {
      for (let x = -1; x <= 7; x += 1) {
        const on = x >= 0 && y >= 0 && x <= 6 && y <= 6 && (x === 0 || y === 0 || x === 6 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4));
        set(ox + x, oy + y, on);
      }
    }
  };
  finder(0, 0);
  finder(n - 7, 0);
  finder(0, n - 7);
  for (let i = 8; i < n - 8; i += 1) {
    set(i, 6, i % 2 === 0);
    set(6, i, i % 2 === 0);
  }
  for (const y of spec.align) {
    for (const x of spec.align) {
      if (inFinder(x, y, n)) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const edge = Math.max(Math.abs(dx), Math.abs(dy)) === 2 || (dx === 0 && dy === 0);
          set(x + dx, y + dy, edge);
        }
      }
    }
  }
  for (let i = 0; i < 15; i += 1) {
    const rowOnCol8 = i < 6 ? i : i < 8 ? i + 1 : n - 15 + i;
    const colOnRow8 = i < 8 ? n - 1 - i : i < 9 ? 15 - i : 14 - i;
    set(8, rowOnCol8, false);
    set(colOnRow8, 8, false);
  }
  set(8, n - 8, true);
  let bit = 0;
  const next = () => {
    const byte = code[bit >> 3] ?? 0;
    const on = ((byte >> (7 - (bit & 7))) & 1) === 1;
    bit += 1;
    return on;
  };
  let upward = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col = 5;
    for (let i = 0; i < n; i += 1) {
      const row = upward ? n - 1 - i : i;
      for (const dx of [0, -1]) {
        const x = col + dx;
        if (grid[row][x] != null) continue;
        let on = next();
        if ((row + x) % 2 === 0) on = !on;
        grid[row][x] = on;
      }
    }
    upward = !upward;
  }
  const FORMAT = 0b111011111000100;
  for (let i = 0; i < 15; i += 1) {
    const on = ((FORMAT >> i) & 1) === 1;
    const rowV = i < 6 ? i : i < 8 ? i + 1 : n - 15 + i;
    const colH = i < 8 ? n - 1 - i : i < 9 ? 15 - i : 14 - i;
    grid[rowV][8] = on;
    grid[8][colH] = on;
  }
  grid[n - 8][8] = true;
  return { n, reserved, dark: (x, y) => grid[y][x] === true };
}

export function qrSvg(text, color = "#111111") {
  const safe = /^#[0-9a-f]{6}$/i.test(color) ? color : "#111111";
  const matrix = qrMatrix(text);
  const cell = 8;
  const quiet = 4;
  const span = matrix.n + quiet * 2;
  let rects = "";
  for (let y = 0; y < matrix.n; y += 1) {
    for (let x = 0; x < matrix.n; x += 1) {
      if (!matrix.dark(x, y)) continue;
      rects += `<rect x="${(x + quiet) * cell}" y="${(y + quiet) * cell}" width="${cell}" height="${cell}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${span * cell} ${span * cell}" role="img" aria-label="Profil kodu"><rect width="100%" height="100%" fill="#ffffff"/><g fill="${safe}">${rects}</g></svg>`;
}
