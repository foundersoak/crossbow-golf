import { describe, expect, it } from 'vitest'
import { readMapConfig } from '../worker/lib/mapConfig'
import type { Env } from '../worker/env'

// Synthetic coordinates only, per the repo privacy rules.
const BUNDLE = {
  PROPERTY_CENTER_LAT: '-41.123456',
  PROPERTY_CENTER_LNG: '-14.654321',
  PROPERTY_BOUNDS_NE_LAT: '-41.122556',
  PROPERTY_BOUNDS_NE_LNG: '-14.653221',
  PROPERTY_BOUNDS_SW_LAT: '-41.124356',
  PROPERTY_BOUNDS_SW_LNG: '-14.655421',
  PROPERTY_DEFAULT_ZOOM: '18'
}

function envWith(config: string): Env {
  return { PROPERTY_CONFIG: config } as unknown as Env
}

describe('readMapConfig with a PROPERTY_CONFIG bundle', () => {
  it('parses a clean JSON bundle', () => {
    const result = readMapConfig(envWith(JSON.stringify(BUNDLE)))
    expect('missing' in result).toBe(false)
    if (!('missing' in result)) {
      expect(result.center.lat).toBeCloseTo(-41.123456)
      expect(result.defaultZoom).toBe(18)
    }
  })

  it('survives iPhone smart quotes and invisible characters', () => {
    const clean = JSON.stringify(BUNDLE)
    const allCurlyLeft = clean.replaceAll('"', '“')
    const allCurlyRight = clean.replaceAll('"', '”')
    const withBom = `﻿${clean}`
    const withZeroWidth = `​${clean}​`
    for (const mangled of [allCurlyLeft, allCurlyRight, withBom, withZeroWidth]) {
      const result = readMapConfig(envWith(mangled))
      expect('missing' in result).toBe(false)
    }
  })

  it('reports unparseable config readably instead of crashing', () => {
    const result = readMapConfig(envWith('{not json at all'))
    expect('missing' in result).toBe(true)
    if ('missing' in result) {
      expect(result.missing[0]).toContain('not valid JSON')
    }
  })

  it('lets individual env vars win over the bundle', () => {
    const env = {
      PROPERTY_CONFIG: JSON.stringify(BUNDLE),
      PROPERTY_CENTER_LAT: '-40.5'
    } as unknown as Env
    const result = readMapConfig(env)
    if (!('missing' in result)) {
      expect(result.center.lat).toBeCloseTo(-40.5)
    } else {
      throw new Error('expected config to parse')
    }
  })
})
