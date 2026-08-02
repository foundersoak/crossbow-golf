// Clock skew estimation. Raw device clocks are never used for ordering;
// every entered timestamp is device time plus this offset, and the server
// still clamps future-dated values on arrival.

const STORAGE_KEY = 'crossbow.clockOffset'

let offsetMs = Number(localStorage.getItem(STORAGE_KEY) ?? '0') || 0
let haveEstimate = localStorage.getItem(STORAGE_KEY) !== null

/**
 * Update the estimate from a request/response pair: we sent at t0 (device
 * clock), the server stamped serverTime, we received at t1. The classic
 * NTP-style midpoint estimate, smoothed so one slow request cannot yank
 * the offset around.
 */
export function observeServerTime(t0: number, serverTime: number, t1: number): void {
  const sample = serverTime - (t0 + t1) / 2
  offsetMs = haveEstimate ? offsetMs * 0.7 + sample * 0.3 : sample
  haveEstimate = true
  localStorage.setItem(STORAGE_KEY, String(Math.round(offsetMs)))
}

/** Skew-corrected "now", used as the entry timestamp for score events. */
export function correctedNow(): number {
  return Date.now() + offsetMs
}

export function clockOffset(): number {
  return offsetMs
}
