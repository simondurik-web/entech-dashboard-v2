import { NextResponse } from 'next/server'
import type { PalletActor } from '@/lib/pallets/guard'

export function forbidden() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

export function adminOnly() {
  return NextResponse.json({ error: 'Admin only' }, { status: 403 })
}

export function actorEmail(actor: PalletActor) {
  return actor.email || actor.userId || 'unknown'
}

export function actorId(actor: PalletActor) {
  return actor.userId
}

export function actorName(actor: PalletActor) {
  return actor.name || actor.email || 'Unknown'
}

export function isOwnRecord(actor: PalletActor, record: { recorded_by?: string | null }) {
  return !!actor.userId && record.recorded_by === actor.userId
}

export function isWithinThreeDays(createdAt: string | null | undefined) {
  if (!createdAt) return false
  const created = new Date(createdAt).getTime()
  if (!Number.isFinite(created)) return false
  return Date.now() - created < 3 * 24 * 60 * 60 * 1000
}

export function pushConfigured() {
  return !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
}

export function pushNotConfigured() {
  return NextResponse.json(
    { error: 'Push notifications are not configured. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.' },
    { status: 501 }
  )
}
