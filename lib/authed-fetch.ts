import { supabase } from '@/lib/supabase'

// Fetch with the Supabase access token + one 401-refresh-retry — the same
// pattern the ship page uses inline; shared here for the truckload UIs.

export async function authedFetch(url: string, init?: RequestInit): Promise<Response> {
  const run = async () => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    return fetch(url, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
  }
  let res = await run()
  if (res.status === 401) {
    await supabase.auth.refreshSession()
    res = await run()
  }
  return res
}

export async function authedJson(url: string, method: 'POST' | 'PATCH' | 'DELETE', body: unknown): Promise<Response> {
  return authedFetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
