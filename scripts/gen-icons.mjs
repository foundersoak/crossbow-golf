// Generates the PWA icons as PNGs with zero image dependencies.
// Flat design: rolling ranch hill, flagstick with orange flag, cream ball.
// Rendered at 4x and box-downsampled for smooth edges, encoded by hand.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const INK = [23, 59, 36] // deep green field
const HILL = [34, 81, 50] // lighter green hill
const CREAM = [247, 244, 234]
const FLAG = [200, 69, 31]

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
  const raw = Buffer.alloc((size * 3 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0
    pixels.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** Render at hi-res in a 100-unit design space, then downsample. */
function drawIcon(target) {
  const SS = 4
  const size = target * SS
  const px = Buffer.alloc(size * size * 3)
  const u = size / 100

  // Hill crest: a gentle sine roll peaking left of center.
  const hillY = (x) => 66 * u + 8 * u * Math.sin((x / size) * Math.PI * 1.4 + 2.2)

  const inside = {
    hill: (x, y) => y >= hillY(x),
    ball: (() => {
      const cx = 30 * u
      const r = 7.5 * u
      return (x, y) => {
        const cy = hillY(cx) - r / 2
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
      }
    })(),
    stick: (x, y) => {
      const sx = 62 * u
      const top = 18 * u
      const bottom = hillY(sx) + 2 * u
      return Math.abs(x - sx) <= 1.1 * u && y >= top && y <= bottom
    },
    flag: (x, y) => {
      const sx = 63.1 * u
      const top = 18 * u
      const h = 14 * u
      const len = 24 * u
      if (x < sx || y < top || y > top + h) return false
      const t = (y - top) / h
      const extent = t <= 0.5 ? t * 2 : (1 - t) * 2
      return x <= sx + len * (0.25 + 0.75 * extent)
    }
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let c = INK
      if (inside.hill(x, y)) c = HILL
      if (inside.stick(x, y)) c = CREAM
      if (inside.flag(x, y)) c = FLAG
      if (inside.ball(x, y)) c = CREAM
      const i = (y * size + x) * 3
      px[i] = c[0]
      px[i + 1] = c[1]
      px[i + 2] = c[2]
    }
  }

  // Box-downsample SS x SS blocks.
  const out = Buffer.alloc(target * target * 3)
  for (let y = 0; y < target; y++) {
    for (let x = 0; x < target; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const i = ((y * SS + dy) * size + x * SS + dx) * 3
          r += px[i]
          g += px[i + 1]
          b += px[i + 2]
        }
      }
      const n = SS * SS
      const o = (y * target + x) * 3
      out[o] = Math.round(r / n)
      out[o + 1] = Math.round(g / n)
      out[o + 2] = Math.round(b / n)
    }
  }
  return encodePng(target, out)
}

mkdirSync('public/icons', { recursive: true })
for (const size of [192, 512]) {
  writeFileSync(`public/icons/icon-${size}.png`, drawIcon(size))
  console.log(`wrote public/icons/icon-${size}.png`)
}
