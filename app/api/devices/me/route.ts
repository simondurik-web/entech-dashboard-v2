import { NextRequest, NextResponse } from "next/server"
import { createHash } from "crypto"
import { supabaseAdmin } from "@/lib/supabase-admin"

// Device session check: the device presents its raw token, we look up the
// hash. Approved → identity payload the client builds its pseudo-profile
// from. Pending/revoked/unknown → status only.

const TOKEN_RE = /^[a-f0-9]{64}$/

export async function GET(req: NextRequest) {
  const token = req.headers.get("x-device-token") ?? ""
  if (!TOKEN_RE.test(token)) {
    return NextResponse.json({ status: "unknown" })
  }

  const tokenHash = createHash("sha256").update(token).digest("hex")
  const { data: device } = await supabaseAdmin
    .from("authorized_devices")
    .select("id, name, role, status")
    .eq("token_hash", tokenHash)
    .maybeSingle()

  if (!device) return NextResponse.json({ status: "unknown" })

  if (device.status === "approved") {
    // Fire-and-forget liveness stamp for the admin panel.
    void supabaseAdmin
      .from("authorized_devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", device.id)
      .then(() => {})
    return NextResponse.json({
      status: "approved",
      device: { id: device.id, name: device.name, role: device.role },
    })
  }

  return NextResponse.json({ status: device.status })
}
