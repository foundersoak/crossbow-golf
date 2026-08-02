import { describe, it, expect } from 'vitest'
import { haversineYards, holeYards, isValidLatLng } from '../shared/geo'

// All coordinates here are synthetic. The latitude-32 cases sit on the
// same parallel as the course (the sanity constants from the brief depend
// only on latitude) but at longitude 0, nowhere near the real property.

describe('haversine sanity checks from the brief', () => {
  it('100 yards is about 0.00082 degrees of latitude at latitude 32', () => {
    const yards = haversineYards({ lat: 32, lng: 0 }, { lat: 32.00082, lng: 0 })
    expect(yards).toBeGreaterThan(99)
    expect(yards).toBeLessThan(101)
  })

  it('100 yards is about 0.00097 degrees of longitude at latitude 32', () => {
    const yards = haversineYards({ lat: 32, lng: 0 }, { lat: 32, lng: 0.00097 })
    expect(yards).toBeGreaterThan(99)
    expect(yards).toBeLessThan(101)
  })

  it('longitude degrees shrink with latitude, latitude degrees do not', () => {
    const latStep = haversineYards({ lat: 60, lng: 10 }, { lat: 60.001, lng: 10 })
    const lngStep = haversineYards({ lat: 60, lng: 10 }, { lat: 60, lng: 10.001 })
    expect(lngStep).toBeLessThan(latStep * 0.55) // cos(60) = 0.5
    const equatorLat = haversineYards({ lat: 0, lng: 10 }, { lat: 0.001, lng: 10 })
    expect(Math.abs(equatorLat - latStep)).toBeLessThan(1)
  })
})

describe('holeYards', () => {
  it('rounds to the nearest whole yard', () => {
    const tee = { lat: 32, lng: 0 }
    const pin = { lat: 32.00082, lng: 0 } // ~99.7 yards
    expect(holeYards(tee, pin)).toBe(100)
  })

  it('is zero for identical points', () => {
    expect(holeYards({ lat: 5, lng: 5 }, { lat: 5, lng: 5 })).toBe(0)
  })

  it('handles a realistic pitch-and-putt range, 50 to 110 yards', () => {
    const tee = { lat: 32, lng: 0 }
    // ~0.00045 deg lat is ~55 yards
    expect(holeYards(tee, { lat: 32.00045, lng: 0 })).toBeGreaterThanOrEqual(50)
    expect(holeYards(tee, { lat: 32.00045, lng: 0 })).toBeLessThanOrEqual(60)
    // ~0.0009 deg lat is ~109 yards
    expect(holeYards(tee, { lat: 32.0009, lng: 0 })).toBeGreaterThanOrEqual(105)
    expect(holeYards(tee, { lat: 32.0009, lng: 0 })).toBeLessThanOrEqual(113)
  })
})

describe('isValidLatLng', () => {
  it('accepts normal coordinates', () => {
    expect(isValidLatLng({ lat: -33.9, lng: 151.2 })).toBe(true)
  })
  it('rejects missing, NaN, and out-of-range values', () => {
    expect(isValidLatLng(null)).toBe(false)
    expect(isValidLatLng({})).toBe(false)
    expect(isValidLatLng({ lat: NaN, lng: 0 })).toBe(false)
    expect(isValidLatLng({ lat: 91, lng: 0 })).toBe(false)
    expect(isValidLatLng({ lat: 0, lng: 181 })).toBe(false)
  })
})
