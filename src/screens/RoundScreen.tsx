import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useRound } from '../lib/roundStore'
import { apiGet, apiSend } from '../lib/api'
import type { RoundDetail } from '../../shared/protocol'
import type { HoleData, OverlayData } from '../../shared/types'
import HoleSnippet from '../components/HoleSnippet'

export default function RoundScreen() {
  const { id } = useParams<{ id: string }>()
  const { player } = useAuth()
  const { state, setScore, getCell } = useRound(id, player?.id)
  const [currentHole, setCurrentHole] = useState<number | null>(null)
  const [view, setView] = useState<'hole' | 'card'>('hole')
  const [busy, setBusy] = useState(false)
  const [overlay, setOverlay] = useState<OverlayData | null>(null)

  useEffect(() => {
    apiGet<OverlayData | null>('/api/overlays/active')
      .then(setOverlay)
      .catch(() => setOverlay(null))
  }, [])

  const holes = useMemo(
    () => (state.layout?.holes ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder),
    [state.layout]
  )
  // Start on the first hole that is missing any score.
  useEffect(() => {
    if (currentHole !== null || holes.length === 0 || !state.round) return
    const firstOpen = holes.find((h) =>
      state.round!.players.some((p) => getCell(p.id, h.holeNumber)?.strokes == null)
    )
    setCurrentHole((firstOpen ?? holes[0]).holeNumber)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holes, state.round, currentHole])

  if (state.error) {
    return (
      <div className="screen-center">
        <div className="notice-card">
          <h1>Round unavailable</h1>
          <p>{state.error}</p>
        </div>
      </div>
    )
  }

  if (!state.round || holes.length === 0) {
    return (
      <div className="screen-center">
        <p className="muted">Loading the round…</p>
      </div>
    )
  }

  const round = state.round
  const isFinal = round.status === 'final'
  const canEdit = !isFinal || player?.isAdmin === true
  const hole = holes.find((h) => h.holeNumber === currentHole) ?? holes[0]

  const totals = round.players.map((p) => {
    let strokes = 0
    let par = 0
    let holesIn = 0
    for (const h of holes) {
      const cell = getCell(p.id, h.holeNumber)
      if (cell?.strokes != null) {
        strokes += cell.strokes
        par += h.par
        holesIn++
      }
    }
    return { player: p, strokes, vsPar: strokes - par, holesIn }
  })

  async function completeRound() {
    if (!window.confirm('Mark this round complete? Scores lock for everyone.')) return
    setBusy(true)
    try {
      await apiSend<RoundDetail>(`/api/rounds/${round.id}/complete`, 'POST')
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not complete the round.')
    } finally {
      setBusy(false)
    }
  }

  async function reopenRound() {
    setBusy(true)
    try {
      await apiSend<RoundDetail>(`/api/rounds/${round.id}/reopen`, 'POST')
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not unlock the round.')
    } finally {
      setBusy(false)
    }
  }

  function share() {
    const url = `${location.origin}/r/${round.joinCode}`
    const text = `Join our round at Crossbow Ranch. Code ${round.joinCode}`
    if (navigator.share) {
      void navigator.share({ url, text }).catch(() => {})
    } else {
      void navigator.clipboard?.writeText(url)
      window.alert('Link copied. Send it to the group.')
    }
  }

  return (
    <div className="round-screen">
      <header className="round-head">
        <div className="round-head-main">
          <span className="round-title">{round.playedOn}</span>
          <span className={`conn-dot conn-${state.connection}`} title={state.connection} />
          {state.queued > 0 && (
            <span className="queued-pill">
              Offline, {state.queued} score{state.queued === 1 ? '' : 's'} queued
            </span>
          )}
        </div>
        <div className="round-head-actions">
          {!isFinal && (
            <button className="chip" onClick={share}>
              Invite · {round.joinCode}
            </button>
          )}
          <button
            className="chip"
            onClick={() => setView(view === 'hole' ? 'card' : 'hole')}
          >
            {view === 'hole' ? 'Card' : 'Holes'}
          </button>
        </div>
      </header>

      {isFinal && (
        <div className="final-banner">
          Final
          {round.completedByName ? `, marked by ${round.completedByName}` : ''}.
          {player?.isAdmin && (
            <button className="btn btn-small" onClick={() => void reopenRound()} disabled={busy}>
              Unlock
            </button>
          )}
        </div>
      )}

      {view === 'hole' ? (
        <>
          <nav className="hole-strip" aria-label="Holes">
            {holes.map((h) => {
              const done = round.players.every(
                (p) => getCell(p.id, h.holeNumber)?.strokes != null
              )
              return (
                <button
                  key={h.id}
                  className={
                    h.holeNumber === hole.holeNumber
                      ? 'hole-pill hole-pill-active'
                      : done
                        ? 'hole-pill hole-pill-done'
                        : 'hole-pill'
                  }
                  onClick={() => setCurrentHole(h.holeNumber)}
                >
                  {h.holeNumber}
                </button>
              )
            })}
          </nav>

          <HoleEntry
            hole={hole}
            round={round}
            viewerId={player?.id}
            canEdit={canEdit}
            getCell={getCell}
            setScore={setScore}
            pendingCells={state.pendingCells}
            overlay={overlay}
          />

          <div className="hole-nav-row">
            <button
              className="btn"
              disabled={hole.holeNumber === holes[0].holeNumber}
              onClick={() => setCurrentHole(hole.holeNumber - 1)}
            >
              ← Prev
            </button>
            <button
              className="btn"
              disabled={hole.holeNumber === holes[holes.length - 1].holeNumber}
              onClick={() => setCurrentHole(hole.holeNumber + 1)}
            >
              Next →
            </button>
          </div>
        </>
      ) : (
        <ScoreCard
          holes={holes}
          round={round}
          totals={totals}
          getCell={getCell}
          onPickCell={(holeNumber) => {
            setCurrentHole(holeNumber)
            setView('hole')
          }}
          onComplete={canEdit && !isFinal ? completeRound : undefined}
          busy={busy}
        />
      )}

      <footer className="totals-bar">
        {totals.map((t) => (
          <div
            key={t.player.id}
            className={t.player.id === player?.id ? 'total-cell total-self' : 'total-cell'}
          >
            <span className="total-name">{t.player.name}</span>
            <span className="total-vspar">
              {t.holesIn === 0 ? '·' : t.vsPar === 0 ? 'E' : t.vsPar > 0 ? `+${t.vsPar}` : t.vsPar}
            </span>
            <span className="total-strokes">{t.holesIn === 0 ? '' : t.strokes}</span>
          </div>
        ))}
      </footer>
    </div>
  )
}

function HoleEntry({
  hole,
  round,
  viewerId,
  canEdit,
  getCell,
  setScore,
  pendingCells,
  overlay
}: {
  hole: HoleData
  round: RoundDetail
  viewerId: string | undefined
  canEdit: boolean
  getCell: (playerId: string, hole: number) => { strokes: number | null; authorPlayerId: string } | undefined
  setScore: (playerId: string, hole: number, strokes: number | null) => Promise<void>
  pendingCells: Set<string>
  overlay: OverlayData | null
}) {
  const nameOf = (id: string) => round.players.find((p) => p.id === id)?.name ?? 'Someone'
  const ordered = [...round.players].sort((a, b) =>
    a.id === viewerId ? -1 : b.id === viewerId ? 1 : a.sortOrder - b.sortOrder
  )

  return (
    <div className="hole-entry">
      <div className="hole-entry-head">
        <span className="hole-number-big">{hole.holeNumber}</span>
        <div>
          <h2 className="sheet-title">{hole.name || `Hole ${hole.holeNumber}`}</h2>
          <p className="sheet-sub">
            Par {hole.par}
            {hole.distanceYards !== null && <> · {hole.distanceYards} yards</>}
          </p>
        </div>
      </div>

      <HoleSnippet hole={hole} overlay={overlay} />

      {ordered.map((p) => {
        const cell = getCell(p.id, hole.holeNumber)
        const strokes = cell?.strokes ?? null
        const enteredByOther =
          cell && cell.strokes != null && cell.authorPlayerId !== p.id
        return (
          <div key={p.id} className={p.id === viewerId ? 'score-row score-row-self' : 'score-row'}>
            <div className="score-row-name">
              {p.name}
              {enteredByOther && (
                <span className="attribution">by {nameOf(cell.authorPlayerId)}</span>
              )}
            </div>
            <div className="score-stepper">
              <button
                className="btn score-btn"
                aria-label={`Lower ${p.name}'s score`}
                disabled={!canEdit || strokes === null || strokes <= 1}
                onClick={() => void setScore(p.id, hole.holeNumber, (strokes ?? hole.par) - 1)}
              >
                −
              </button>
              <button
                className="score-value"
                disabled={!canEdit}
                onClick={() => {
                  if (strokes === null) void setScore(p.id, hole.holeNumber, hole.par)
                }}
                aria-label={
                  strokes === null ? `Set ${p.name}'s score to par` : `${p.name}: ${strokes}`
                }
              >
                {strokes ?? 'Par?'}
                {pendingCells.has(`${p.id}:${hole.holeNumber}`) && (
                  <span className="pending-dot" title="Waiting to sync" />
                )}
              </button>
              <button
                className="btn score-btn"
                aria-label={`Raise ${p.name}'s score`}
                disabled={!canEdit || (strokes !== null && strokes >= 30)}
                onClick={() => void setScore(p.id, hole.holeNumber, (strokes ?? hole.par - 1) + 1)}
              >
                +
              </button>
              <button
                className="btn btn-ghost score-clear"
                aria-label={`Clear ${p.name}'s score`}
                disabled={!canEdit || strokes === null}
                onClick={() => void setScore(p.id, hole.holeNumber, null)}
              >
                ✕
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ScoreCard({
  holes,
  round,
  totals,
  getCell,
  onPickCell,
  onComplete,
  busy
}: {
  holes: HoleData[]
  round: RoundDetail
  totals: { player: { id: string; name: string }; strokes: number; vsPar: number; holesIn: number }[]
  getCell: (playerId: string, hole: number) => { strokes: number | null; authorPlayerId: string } | undefined
  onPickCell: (holeNumber: number) => void
  onComplete?: () => Promise<void>
  busy: boolean
}) {
  return (
    <div className="scorecard">
      <div className="scorecard-scroll">
        <table>
          <thead>
            <tr>
              <th className="sticky-col">Hole</th>
              {holes.map((h) => (
                <th key={h.id}>{h.holeNumber}</th>
              ))}
              <th>Tot</th>
            </tr>
            <tr className="par-row">
              <th className="sticky-col">Par</th>
              {holes.map((h) => (
                <th key={h.id}>{h.par}</th>
              ))}
              <th>{holes.reduce((s, h) => s + h.par, 0)}</th>
            </tr>
          </thead>
          <tbody>
            {round.players.map((p) => {
              const t = totals.find((x) => x.player.id === p.id)!
              return (
                <tr key={p.id}>
                  <td className="sticky-col player-col">{p.name}</td>
                  {holes.map((h) => {
                    const cell = getCell(p.id, h.holeNumber)
                    const s = cell?.strokes ?? null
                    const byOther = cell && s != null && cell.authorPlayerId !== p.id
                    const par = h.par
                    const cls =
                      s == null
                        ? ''
                        : s === 1
                          ? 'cell-ace'
                          : s < par
                            ? 'cell-under'
                            : s === par
                              ? ''
                              : 'cell-over'
                    return (
                      <td key={h.id} className={cls} onClick={() => onPickCell(h.holeNumber)}>
                        {s ?? ''}
                        {byOther && <sup className="attribution-mark">*</sup>}
                      </td>
                    )
                  })}
                  <td className="total-col">{t.holesIn > 0 ? t.strokes : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">* entered by someone else in the group</p>
      {onComplete && (
        <button className="btn btn-primary btn-block" onClick={() => void onComplete()} disabled={busy}>
          {busy ? 'Working…' : 'Complete round'}
        </button>
      )}
    </div>
  )
}
