// A Leaflet layer that renders an image warped to four arbitrary corner
// coordinates using a CSS matrix3d homography. This is the same technique
// Leaflet.DistortableImage uses, implemented directly so the app carries
// no stale dependencies. Corners come from the database, so the drone
// overlay alignment is fully reproducible.

import L from 'leaflet'
import type { OverlayCorners } from '../../shared/types'

type Vec9 = number[]

function adjugate(m: Vec9): Vec9 {
  return [
    m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
    m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
    m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]
  ]
}

function multmm(a: Vec9, b: Vec9): Vec9 {
  const c = new Array<number>(9)
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let sum = 0
      for (let k = 0; k < 3; k++) sum += a[3 * i + k] * b[3 * k + j]
      c[3 * i + j] = sum
    }
  }
  return c
}

function multmv(m: Vec9, v: number[]): number[] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2]
  ]
}

function basisToPoints(
  x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number
): Vec9 {
  const m: Vec9 = [x1, x2, x3, y1, y2, y3, 1, 1, 1]
  const v = multmv(adjugate(m), [x4, y4, 1])
  return multmm(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]])
}

/** Projective transform mapping four source points onto four destinations. */
function general2DProjection(
  x1s: number, y1s: number, x1d: number, y1d: number,
  x2s: number, y2s: number, x2d: number, y2d: number,
  x3s: number, y3s: number, x3d: number, y3d: number,
  x4s: number, y4s: number, x4d: number, y4d: number
): Vec9 {
  const s = basisToPoints(x1s, y1s, x2s, y2s, x3s, y3s, x4s, y4s)
  const d = basisToPoints(x1d, y1d, x2d, y2d, x3d, y3d, x4d, y4d)
  return multmm(d, adjugate(s))
}

export class DistortedImageOverlay extends L.Layer {
  private url: string
  private corners: OverlayCorners
  private opacity: number
  private img: HTMLImageElement | null = null
  private loaded = false

  constructor(url: string, corners: OverlayCorners, opacity: number) {
    super()
    this.url = url
    this.corners = corners
    this.opacity = opacity
  }

  onAdd(map: L.Map): this {
    const img = document.createElement('img')
    img.src = this.url
    img.alt = ''
    img.style.position = 'absolute'
    img.style.transformOrigin = '0 0'
    img.style.pointerEvents = 'none'
    img.style.opacity = String(this.opacity)
    img.style.willChange = 'transform'
    img.onload = () => {
      this.loaded = true
      img.style.width = `${img.naturalWidth}px`
      img.style.height = `${img.naturalHeight}px`
      this.reposition()
    }
    this.img = img
    map.getPanes().overlayPane.appendChild(img)
    map.on('zoomend viewreset move moveend', this.reposition, this)
    this.reposition()
    return this
  }

  onRemove(map: L.Map): this {
    map.off('zoomend viewreset move moveend', this.reposition, this)
    this.img?.remove()
    this.img = null
    return this
  }

  setCorners(corners: OverlayCorners): void {
    this.corners = corners
    this.reposition()
  }

  setOpacity(opacity: number): void {
    this.opacity = opacity
    if (this.img) this.img.style.opacity = String(opacity)
  }

  private reposition(): void {
    const map = this._map
    const img = this.img
    if (!map || !img || !this.loaded) return
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (!w || !h) return

    const nw = map.latLngToLayerPoint([this.corners.nw.lat, this.corners.nw.lng])
    const ne = map.latLngToLayerPoint([this.corners.ne.lat, this.corners.ne.lng])
    const se = map.latLngToLayerPoint([this.corners.se.lat, this.corners.se.lng])
    const sw = map.latLngToLayerPoint([this.corners.sw.lat, this.corners.sw.lng])

    const t = general2DProjection(
      0, 0, nw.x, nw.y,
      w, 0, ne.x, ne.y,
      0, h, sw.x, sw.y,
      w, h, se.x, se.y
    )
    if (!Number.isFinite(t[8]) || t[8] === 0) return
    for (let i = 0; i < 9; i++) t[i] /= t[8]
    const m = [
      t[0], t[3], 0, t[6],
      t[1], t[4], 0, t[7],
      0, 0, 1, 0,
      t[2], t[5], 0, t[8]
    ]
    img.style.transform = `matrix3d(${m.join(',')})`
  }
}
