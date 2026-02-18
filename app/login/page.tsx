"use client"

import { useAuth } from "@/lib/auth-context"
import { LogIn } from "lucide-react"
import Link from "next/link"

export default function LoginPage() {
  const { signIn } = useAuth()

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0f1f38] to-[#1a365d]">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-8 text-center backdrop-blur-sm">
        <h1 className="mb-1 text-2xl font-bold text-white">Entech Dashboard</h1>
        <p className="mb-8 text-sm text-white/60">Molding Operations</p>

        <button
          onClick={signIn}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          <LogIn className="size-4" />
          Sign in with Google
        </button>

        <Link
          href="/orders"
          className="mt-4 inline-block text-sm text-white/50 hover:text-white/80"
        >
          Continue as visitor →
        </Link>
      </div>
    </div>
  )
}
