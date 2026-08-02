// Generates the PWA icons as PNGs with zero image dependencies.
// Draws a flag on a green field, pixel by pixel, and encodes a PNG by hand.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

function crc32(buf) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length)
  return out
}

function encodePng(size, pixels) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4)
  const set = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 4
    px[i] = r
    px[i + 1] = g
    px[i + 2] = b
    px[i + 3] = 255
  }
  const u = size / 100 // work in a 100-unit design space

  // Field: deep green with rounded corners
  const corner = 18 * u
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.max(corner - x, x - (size - 1 - corner), 0)
      const cy = Math.max(corner - y, y - (size - 1 - corner), 0)
      if (cx * cx + cy * cy > corner * corner) continue
      set(x, y, 23, 59, 36)
    }
  }
  // Ball: white circle lower-left
  const bx = 32 * u
  const by = 68 * u
  const br = 13 * u
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - bx
      const dy = y - by
      if (dx * dx + dy * dy <= br * br) set(x, y, 247, 244, 234)
    }
  }
  // Flagstick
  for (let y = Math.round(20 * u); y <= Math.round(78 * u); y++) {
    for (let x = Math.round(62 * u); x <= Math.round(65 * u); x++) {
      set(x, y, 247, 244, 234)
    }
  }
  // Flag: orange triangle pointing right
  const fy0 = 20 * u
  const fy1 = 38 * u
  const fx0 = 65 * u
  const fx1 = 88 * u
  for (let y = Math.round(fy0); y <= Math.round(fy1); y++) {
    const t = (y - fy0) / (fy1 - fy0)
    const extent = t <= 0.5 ? t * 2 : (1 - t) * 2
    for (let x = Math.round(fx0); x <= Math.round(fx0 + (fx1 - fx0) * extent); x++) {
      set(x, y, 200, 69, 31)
    }
  }
  return encodePng(size, px)
}

mkdirSync('public/icons', { recursive: true })
for (const size of [192, 512]) {
  writeFileSync(`public/icons/icon-${size}.png`, drawIcon(size))
  console.log(`wrote public/icons/icon-${size}.png`)
}
