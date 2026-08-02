const KEY = 'crossbow.deviceId'

export function getDeviceId(): string {
  let id = localStorage.getItem(KEY)
  if (!id) {
    id = crypto.randomUUID().replaceAll('-', '').slice(0, 16)
    localStorage.setItem(KEY, id)
  }
  return id
}
