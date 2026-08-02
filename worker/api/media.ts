import type { Env } from '../env'
import { json, HttpError } from '../lib/http'
import { randomId, requireAdmin, requireSession, type SessionInfo } from '../lib/session'

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic'
}

export async function handleUpload(
  request: Request,
  env: Env,
  session: SessionInfo | null
): Promise<Response> {
  requireAdmin(session)
  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) throw new HttpError(400, 'Attach an image file.')
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, 'Image is too large (8 MB max).')
  const ext = ALLOWED_TYPES[file.type]
  if (!ext) throw new HttpError(415, 'Use a JPEG, PNG, WebP, or HEIC image.')

  const key = `uploads/${randomId()}${ext}`
  await env.MEDIA.put(key, file.stream(), {
    httpMetadata: { contentType: file.type }
  })
  return json({ key })
}

export async function handleServeMedia(
  env: Env,
  session: SessionInfo | null,
  key: string
): Promise<Response> {
  requireSession(session)
  if (!key.startsWith('uploads/') || key.includes('..')) {
    throw new HttpError(400, 'Bad media key.')
  }
  const object = await env.MEDIA.get(key)
  if (!object) throw new HttpError(404, 'Image not found.')
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('cache-control', 'private, max-age=86400')
  return new Response(object.body, { headers })
}
