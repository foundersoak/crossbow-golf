import type { Env } from './env'
import { json, errorResponse, HttpError } from './lib/http'
import { readMapConfig } from './lib/mapConfig'
import { getSession, requireSession, touchSession } from './lib/session'
import {
  handleClaim,
  handleEnter,
  handleLogout,
  handleMe,
  handleRoster
} from './api/auth'
import {
  handleCurrentLayout,
  handleGetDraft,
  handleLayoutById,
  handleLayoutList,
  handlePublishDraft,
  handleSaveDraft
} from './api/layouts'
import { handleServeMedia, handleUpload } from './api/media'
import {
  handleAddPlayer,
  handleRenamePlayer,
  handleRotateInviteCode,
  handleSetAdmin
} from './api/admin'
import {
  handleCompleteRound,
  handleCreateRound,
  handleGetRound,
  handleJoinClaim,
  handleJoinInfo,
  handleListRounds,
  handlePostEvents,
  handleReopenRound,
  handleRoundSocket
} from './api/rounds'

import {
  handleHoleStats,
  handleLeaderboard,
  handlePlayerProfile,
  handleRecords
} from './api/stats'

export { RoundRoom } from './do/RoundRoom'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url)
      } catch (err) {
        if (err instanceof HttpError) return errorResponse(err.message, err.status)
        console.error('api error', err)
        return errorResponse('Something went wrong on the server.', 500)
      }
    }

    return env.ASSETS.fetch(request)
  }
} satisfies ExportedHandler<Env>

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const { pathname } = url
  const method = request.method

  if (pathname === '/api/health') return json({ ok: true })

  const session = await getSession(request, env)
  if (session) void touchSession(env, session.tokenHash).catch(() => {})

  // Auth
  if (pathname === '/api/auth/enter' && method === 'POST') return handleEnter(request, env, url)
  if (pathname === '/api/me' && method === 'GET') return handleMe(session)
  if (pathname === '/api/roster' && method === 'GET') return handleRoster(env, session)
  if (pathname === '/api/auth/claim' && method === 'POST') return handleClaim(request, env, session)
  if (pathname === '/api/auth/logout' && method === 'POST') return handleLogout(env, session, url)

  // Map config (session required so coordinates stay behind the gate)
  if (pathname === '/api/config' && method === 'GET') {
    requireSession(session)
    const config = readMapConfig(env)
    if ('missing' in config) {
      return json(
        {
          error:
            'The map is not configured yet. Set the property location in .dev.vars (local) or as Wrangler secrets (production). See the README.',
          missing: config.missing
        },
        503
      )
    }
    return json(config)
  }

  // Layouts
  if (pathname === '/api/layouts' && method === 'GET') return handleLayoutList(env, session)
  if (pathname === '/api/layouts/current' && method === 'GET')
    return handleCurrentLayout(env, session)
  if (pathname === '/api/draft' && method === 'GET') return handleGetDraft(env, session)
  if (pathname === '/api/draft' && method === 'PUT') return handleSaveDraft(request, env, session)
  if (pathname === '/api/draft/publish' && method === 'POST')
    return handlePublishDraft(request, env, session)
  {
    const m = pathname.match(/^\/api\/layouts\/([A-Za-z0-9]+)$/)
    if (m && method === 'GET') return handleLayoutById(env, session, m[1])
  }

  // Rounds and live scoring
  if (pathname === '/api/rounds' && method === 'POST')
    return handleCreateRound(request, env, session)
  if (pathname === '/api/rounds' && method === 'GET') return handleListRounds(env, session)
  {
    const m = pathname.match(/^\/api\/rounds\/([A-Za-z0-9]+)(\/[a-z]+)?$/)
    if (m) {
      const [, roundId, sub] = m
      if (!sub && method === 'GET') return handleGetRound(env, session, roundId)
      if (sub === '/events' && method === 'POST')
        return handlePostEvents(request, env, session, roundId)
      if (sub === '/ws' && method === 'GET')
        return handleRoundSocket(request, env, session, roundId)
      if (sub === '/complete' && method === 'POST')
        return handleCompleteRound(env, session, roundId)
      if (sub === '/reopen' && method === 'POST') return handleReopenRound(env, session, roundId)
    }
    const j = pathname.match(/^\/api\/join\/([A-Za-z0-9]+)$/)
    if (j && method === 'GET') return handleJoinInfo(env, j[1])
    if (j && method === 'POST') return handleJoinClaim(request, env, session, j[1], url)
  }

  // Stats
  if (pathname === '/api/stats/leaderboard' && method === 'GET')
    return handleLeaderboard(env, session, url)
  if (pathname === '/api/stats/holes' && method === 'GET')
    return handleHoleStats(env, session, url)
  if (pathname === '/api/stats/records' && method === 'GET') return handleRecords(env, session)
  {
    const m = pathname.match(/^\/api\/stats\/player\/([A-Za-z0-9]+)$/)
    if (m && method === 'GET') return handlePlayerProfile(env, session, m[1])
  }

  // Media
  if (pathname === '/api/media' && method === 'POST') return handleUpload(request, env, session)
  if (pathname.startsWith('/api/media/') && method === 'GET') {
    return handleServeMedia(env, session, pathname.slice('/api/media/'.length))
  }

  // Admin
  if (pathname === '/api/admin/players' && method === 'POST')
    return handleAddPlayer(request, env, session)
  if (pathname === '/api/admin/invite-code' && method === 'POST')
    return handleRotateInviteCode(request, env, session)
  {
    const m = pathname.match(/^\/api\/admin\/players\/([A-Za-z0-9]+)\/admin$/)
    if (m && method === 'POST') return handleSetAdmin(request, env, session, m[1])
    const r = pathname.match(/^\/api\/admin\/players\/([A-Za-z0-9]+)\/name$/)
    if (r && method === 'POST') return handleRenamePlayer(request, env, session, r[1])
  }

  return errorResponse('Not found.', 404)
}
