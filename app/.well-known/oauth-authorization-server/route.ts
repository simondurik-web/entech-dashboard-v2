import { NextRequest } from "next/server"
import { authorizationServerMetadata, corsPreflight, jsonWithCors } from "@/lib/mcp/oauth-metadata"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  return jsonWithCors(authorizationServerMetadata(req))
}

export async function OPTIONS() {
  return corsPreflight()
}
