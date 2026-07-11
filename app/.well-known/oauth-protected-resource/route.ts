import { NextRequest } from "next/server"
import { corsPreflight, jsonWithCors, protectedResourceMetadata } from "@/lib/mcp/oauth-metadata"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  return jsonWithCors(protectedResourceMetadata(req))
}

export async function OPTIONS() {
  return corsPreflight()
}
