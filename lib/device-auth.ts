// Client-side half of the authorized-devices flow (shared floor computers).
// The device generates a random token once, keeps it in localStorage forever
// (survives reboots/power outages), and sends it as `x-device-token`. The
// server only ever sees/stores the sha256 hash. Admin approval + role live
// server-side in authorized_devices; revoking there kills the device session
// on its next check.

const DEVICE_TOKEN_KEY = "edv2.device.token.v1"

export function getDeviceToken(): string | null {
  try {
    return localStorage.getItem(DEVICE_TOKEN_KEY)
  } catch {
    return null
  }
}

export function getOrCreateDeviceToken(): string | null {
  const existing = getDeviceToken()
  if (existing) return existing
  try {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
    localStorage.setItem(DEVICE_TOKEN_KEY, token)
    return token
  } catch {
    return null
  }
}

export function clearDeviceToken(): void {
  try {
    localStorage.removeItem(DEVICE_TOKEN_KEY)
  } catch {
    // ignore
  }
}

export type DeviceStatus = {
  status: "pending" | "approved" | "revoked" | "unknown"
  device?: { id: string; name: string; role: string }
}

export async function checkDeviceStatus(token: string): Promise<DeviceStatus | null> {
  try {
    const res = await fetch("/api/devices/me", {
      headers: { "x-device-token": token },
      cache: "no-store",
    })
    if (!res.ok) return null
    return (await res.json()) as DeviceStatus
  } catch {
    return null
  }
}
