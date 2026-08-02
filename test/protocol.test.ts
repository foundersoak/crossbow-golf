import { describe, it, expect } from 'vitest'
import { candidateWins, validStrokes } from '../shared/protocol'

describe('candidateWins (the LWW rule every replica shares)', () => {
  it('an empty cell always loses to a candidate', () => {
    expect(candidateWins(null, { enteredAt: 1, clientWriteId: 'a' })).toBe(true)
    expect(candidateWins(undefined, { enteredAt: 1, clientWriteId: 'a' })).toBe(true)
  })

  it('later entry time wins regardless of arrival order', () => {
    const current = { enteredAt: 1000, clientWriteId: 'a' }
    expect(candidateWins(current, { enteredAt: 2000, clientWriteId: 'b' })).toBe(true)
    expect(candidateWins(current, { enteredAt: 500, clientWriteId: 'b' })).toBe(false)
  })

  it('breaks exact ties deterministically by write id', () => {
    const current = { enteredAt: 1000, clientWriteId: 'aaa' }
    expect(candidateWins(current, { enteredAt: 1000, clientWriteId: 'bbb' })).toBe(true)
    expect(candidateWins(current, { enteredAt: 1000, clientWriteId: '000' })).toBe(false)
    // Symmetry: the loser of the tie also agrees it lost.
    expect(candidateWins({ enteredAt: 1000, clientWriteId: 'bbb' }, current)).toBe(false)
  })
})

describe('validStrokes', () => {
  it('accepts whole strokes 1 to 30 and nothing else', () => {
    expect(validStrokes(1)).toBe(true)
    expect(validStrokes(30)).toBe(true)
    expect(validStrokes(0)).toBe(false)
    expect(validStrokes(31)).toBe(false)
    expect(validStrokes(2.5)).toBe(false)
    expect(validStrokes(null)).toBe(false)
    expect(validStrokes('3')).toBe(false)
  })
})
