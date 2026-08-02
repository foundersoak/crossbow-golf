import type { Env } from './env'
import { json, errorResponse } from './lib/http'
import { readMapConfig } from './lib/mapConfig'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url).catch((err) => {
        console.error('api error', err)
        return errorResponse('Something went wrong on the server.', 500)
      })
    }

    // Non-API requests are handled by static assets (SPA fallback).
    return env.ASSETS.fetch(request)
  }
} satisfies ExportedHandler<Env>

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const { pathname } = url

  if (pathname === '/api/health') {
    return json({ ok: true })
  }

  if (pathname === '/api/config' && request.method === 'GET') {
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

  return errorResponse('Not found.', 404)
}
