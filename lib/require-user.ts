import { NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createHash, timingSafeEqual } from "crypto"
import { supabaseAdmin } from "@/lib/supabase-admin"

export type AuthedUser = { id: string; email: string | null }
export type AuthedUserOrService = AuthedUser & { isService?: boolean }
export type AuthedActor = { id: string; email: string | null; kind: "user" | "device"; role?: string }

/**
 * Derive the caller's identity from the verified Supabase Bearer JWT.
 *
 * This is the hardened replacement for the old `req.headers.get("x-user-id")`
 * pattern, which trusted a browser-supplied header — anyone who knew an
 * enrolled user's UUID could spoof it and act as them. The id/email returned
 * here are verified by Supabase Auth (`auth.getUser(token)`) and cannot be
 * forged by the client.
 *
 * Returns `null` when no valid Bearer token is present (no header, malformed
 * token, or token rejected by Supabase). Callers that previously did
 * `if (!userId) return 401` keep that exact behavior by using `(await
 * requireUser(req))?.id` and leaving their null-check in place.
 *
 * Mirrors `getUserFromRequest` in app/api/auth/profile/route.ts (the one route
 * that already did this correctly); centralized so every protected route shares
 * one implementation.
 */
// Takes a plain `Request` (not NextRequest) because it only ever reads a
// header — that lets the Pallet Records / Quality guards, which are typed
// against `Request`, share this one verification path. NextRequest is a
// Request, so every existing NextRequest call site is unaffected.
export async function requireUser(req: Request): Promise<AuthedUser | null> {
  const authHeader = req.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) return null
  const token = authHeader.slice(7)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token)
  if (error || !user) return null

  // DEACTIVATION IS ENFORCED HERE, and here only, on purpose.
  //
  // Three review rounds on 2026-07-27 each found the same defect at a new site
  // — scheduling's getProfileFromHeader, admin/users' local isAdmin,
  // labels/settings' local isAdmin, requirePermission's super-admin
  // short-circuit, lib/erpnext/auth's own profile read. Every one of them
  // resolved a role without looking at is_active, so "deactivate user" did
  // nothing until their token expired. Patching them one at a time was losing
  // ground: the next hand-rolled guard would have reintroduced it.
  //
  // Putting it in the single function that turns a token into an identity
  // means a caller cannot forget it — there is no path to a user id that
  // skips this. `=== false` so rows predating the column stay allowed.
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("user_profiles")
    .select("is_active")
    .eq("id", user.id)
    .maybeSingle()
  // Fail CLOSED if the lookup itself fails. Swallowing the error would mean a
  // database blip authenticates the very tokens this check exists to reject
  // (codex, review panel round 5). A missing ROW is different and stays
  // allowed — profiles predating this column legitimately have no is_active.
  if (profileErr) return null
  if (profile?.is_active === false) return null

  return { id: user.id, email: user.email ?? null }
}

function safeEqual(a: string, b: string): boolean {
  // Hash both sides to fixed-length (32-byte) digests first, so the comparison
  // is constant-time even when the inputs differ in length (no early-return
  // length leak).
  const ah = createHash("sha256").update(a).digest()
  const bh = createHash("sha256").update(b).digest()
  return timingSafeEqual(ah, bh)
}

/**
 * Like {@link requireUser}, but ALSO accepts a trusted server-to-server caller
 * that presents the shared automation key in the `x-service-key` header
 * (compared in constant time against `PO_AUTOMATION_API_KEY`).
 *
 * Used by the PO automation scripts that run with NO Supabase user session —
 * currently the BOL / PO-PDF auto-uploaders `release_toter.py` and
 * `attach_po_pdf.py`, which POST to /api/po-automation/documents. For a valid
 * service call, attribution falls back to the `x-user-id` header — which is
 * safe HERE because it is gated behind the secret key (a browser cannot set a
 * valid `x-service-key`), unlike the bare `x-user-id` trust this hardening
 * removed everywhere else.
 *
 * If the service key is absent/invalid, this is exactly `requireUser` (Bearer
 * JWT), so normal users are unaffected.
 */
const DEVICE_TOKEN_RE = /^[a-f0-9]{64}$/

/**
 * Like {@link requireUser}, but ALSO accepts an approved shared-floor device.
 *
 * Floor PCs have no Supabase login; they present the `x-device-token` they
 * generated at pairing (the server only ever stores its sha256 hash). We
 * validate the hash against `authorized_devices` and require status=approved —
 * the same check /api/devices/me does. Returns the device's id + role so the
 * caller can attribute the write and (if it wants) gate on the device role.
 *
 * Use on routes that floor devices legitimately write to (e.g. labels:
 * mark-printed). Devices can never hold the admin role, so admin routes that
 * check for role==='admin' stay device-proof even when using this helper.
 */
export async function requireUserOrDevice(req: NextRequest): Promise<AuthedActor | null> {
  const user = await requireUser(req)
  if (user) return { id: user.id, email: user.email, kind: "user" }

  const token = req.headers.get("x-device-token") ?? ""
  if (DEVICE_TOKEN_RE.test(token)) {
    const tokenHash = createHash("sha256").update(token).digest("hex")
    const { data: device } = await supabaseAdmin
      .from("authorized_devices")
      .select("id, role, status")
      .eq("token_hash", tokenHash)
      .maybeSingle()
    if (device && device.status === "approved") {
      return { id: device.id, email: null, kind: "device", role: device.role }
    }
  }
  return null
}

export async function requireUserOrService(req: NextRequest): Promise<AuthedUserOrService | null> {
  const expected = process.env.PO_AUTOMATION_API_KEY
  const provided = req.headers.get("x-service-key")
  if (expected && provided && safeEqual(provided, expected)) {
    const uid = req.headers.get("x-user-id")
    // isService = the secret key IS the authorization; callers should skip the
    // per-user role check (the fallback id is only for audit attribution and
    // would not pass canAccess* anyway).
    return { id: uid || "po-automation-service", email: null, isService: true }
  }
  return requireUser(req)
}

const DASHBOARD_APP_ID = "dashboard"
const SUPER_ADMIN_EMAIL = "simondurik@gmail.com"

/**
 * Verified ENROLLED dashboard user (any role except visitor/blocked) OR an
 * approved floor device. Use for business-data READ routes: closes anonymous
 * AND non-enrolled (visitor) access while keeping every enrolled user + floor
 * device working. Returns the actor (with resolved role) or null.
 */
export async function requireDashboardAccess(req: NextRequest): Promise<AuthedActor | null> {
  const actor = await requireUserOrDevice(req)
  if (!actor) return null
  // Approved devices carry a role too, and it has to clear the same bar a
  // person's does: 'blocked' and 'visitor' are both out. This used to wave
  // every approved device through on the strength of approval alone (codex,
  // review panel 2026-07-27). A device with NO role also fails, which is the
  // safe direction — it loses access rather than silently gaining it.
  if (actor.kind === "device") {
    const role = actor.role ?? ""
    return role && role !== "blocked" && role !== "visitor" ? actor : null
  }
  const p = await loadDashboardProfile(actor.id)
  if (p.role === "visitor" || p.role === "blocked") return null
  return { ...actor, role: p.role }
}

/**
 * Gate for business-data READ routes: a trusted service caller (x-service-key,
 * e.g. the PO-automation quote engine) OR {@link requireDashboardAccess}
 * (enrolled user / approved device). Anonymous and non-enrolled callers get null.
 */
export async function requireReadAccess(req: NextRequest): Promise<AuthedActor | null> {
  const expected = process.env.PO_AUTOMATION_API_KEY
  const provided = req.headers.get("x-service-key")
  if (expected && provided && safeEqual(provided, expected)) {
    return {
      id: req.headers.get("x-user-id") || "po-automation-service",
      email: null,
      kind: "user",
      role: "service",
    }
  }
  return requireDashboardAccess(req)
}

/** Resolve a user's effective dashboard role + custom_permissions (role from the
 *  dashboard app-role; no enrollment -> 'visitor'). Exported for routes that
 *  need the ROLE after a requirePermission pass (e.g. printer-station ACLs). */
export async function loadDashboardProfile(
  userId: string
): Promise<{ email: string | null; role: string; custom_permissions: Record<string, boolean> | null }> {
  const [{ data: profile }, { data: appRole }] = await Promise.all([
    supabaseAdmin.from("user_profiles").select("email, custom_permissions").eq("id", userId).maybeSingle(),
    supabaseAdmin
      .from("user_app_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("app_id", DASHBOARD_APP_ID)
      .maybeSingle(),
  ])
  // No is_active check here: requireUser already refused a deactivated caller
  // before any id reaches this function. Keeping a second copy would invite the
  // two to drift.
  return {
    email: (profile?.email as string | null) ?? null,
    role: (appRole?.role as string | undefined) ?? "visitor",
    custom_permissions: (profile?.custom_permissions as Record<string, boolean> | null) ?? null,
  }
}

/**
 * Verified caller who is a dashboard admin (or the hardcoded super admin),
 * else null. Use for admin-only routes: `if (!(await requireAdmin(req))) 403`.
 * Returns the AuthedUser so the route can attribute the action to the real id.
 */
export async function requireAdmin(req: Request): Promise<AuthedUser | null> {
  const user = await requireUser(req)
  if (!user) return null
  const p = await loadDashboardProfile(user.id)
  // is_active is folded into the role above, so a deactivated account resolves
  // to 'blocked' and is denied here — including the hardcoded super admin.
  if (p.role === "blocked") return null
  if (user.email && user.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) return user
  return p.role === "admin" ? user : null
}

/**
 * Verified caller who holds a given dashboard menu permission, else null —
 * the server-side mirror of the client `canAccess(permKey)`: admin, an explicit
 * custom_permissions[permKey], or role_permissions.menu_access[permKey] === true.
 */
export async function requirePermission(req: NextRequest, permKey: string): Promise<AuthedUser | null> {
  const user = await requireUser(req)
  if (!user) return null
  const p = await loadDashboardProfile(user.id)
  // 'blocked' is checked before the super-admin override so this matches
  // requireAdmin exactly — the override used to short-circuit first, which meant
  // the two admin paths disagreed about a blocked super admin (grok, review
  // panel round 3).
  if (p.role === "blocked") return null
  if (user.email && user.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) return user
  // Mirror the client's canAccess exactly (blocked was already denied above,
  // before the super-admin override) ...
  if (p.role === "admin") return user
  // ... and an explicit per-user override wins in BOTH directions — a stored
  // `false` must deny even when the role would allow (previously it silently
  // fell through to the role check).
  const custom = p.custom_permissions?.[permKey]
  if (custom === true) return user
  if (custom === false) return null
  const { data: rolePerm } = await supabaseAdmin
    .from("role_permissions")
    .select("menu_access")
    .eq("role", p.role)
    .maybeSingle()
  const access = (rolePerm?.menu_access ?? {}) as Record<string, boolean>
  return access?.[permKey] === true ? user : null
}

/**
 * {@link requirePermission}, but ALSO accepts an approved shared-floor device
 * whose device ROLE grants the permission (admin/super_admin devices bypass,
 * like users). Floor tablets have no Supabase login yet legitimately use
 * business pages (e.g. the shipments print page); their per-station printer
 * ACL still applies downstream via the returned actor id + role.
 */
export async function requirePermissionOrDevice(
  req: NextRequest,
  permKey: string
): Promise<AuthedActor | null> {
  const user = await requirePermission(req, permKey)
  if (user) return { id: user.id, email: user.email, kind: "user" }

  const actor = await requireUserOrDevice(req)
  if (!actor || actor.kind !== "device") return null
  const role = actor.role ?? ""
  if (role === "blocked") return null
  if (role === "admin" || role === "super_admin") return actor
  const { data: rolePerm } = await supabaseAdmin
    .from("role_permissions")
    .select("menu_access")
    .eq("role", role)
    .maybeSingle()
  const access = (rolePerm?.menu_access ?? {}) as Record<string, boolean>
  return access?.[permKey] === true ? actor : null
}
