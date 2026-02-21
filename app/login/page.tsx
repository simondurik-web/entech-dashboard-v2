"use client"

import { useAuth } from "@/lib/auth-context"
import { LogIn } from "lucide-react"
import Link from "next/link"

export default function LoginPage() {
  const { signIn } = useAuth()

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0a0e1a]">
      {/* Aurora Background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="aurora-blob aurora-blob-1" />
        <div className="aurora-blob aurora-blob-2" />
        <div className="aurora-blob aurora-blob-3" />
      </div>

      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-8 text-center backdrop-blur-md">
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

      <style jsx>{`
        .aurora-blob {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.4;
          mix-blend-mode: screen;
        }
        .aurora-blob-1 {
          width: 500px;
          height: 500px;
          background: radial-gradient(circle, #1e3a5f, #0d1b2a);
          top: -10%;
          left: -10%;
          animation: aurora-drift-1 12s ease-in-out infinite alternate;
        }
        .aurora-blob-2 {
          width: 400px;
          height: 400px;
          background: radial-gradient(circle, #6b21a8, #1e1b4b);
          bottom: -5%;
          right: -5%;
          animation: aurora-drift-2 10s ease-in-out infinite alternate;
        }
        .aurora-blob-3 {
          width: 350px;
          height: 350px;
          background: radial-gradient(circle, #0d9488, #064e3b);
          top: 40%;
          left: 50%;
          animation: aurora-drift-3 14s ease-in-out infinite alternate;
        }
        @keyframes aurora-drift-1 {
          0% { transform: translate(0, 0) scale(1); }
          100% { transform: translate(80px, 60px) scale(1.2); }
        }
        @keyframes aurora-drift-2 {
          0% { transform: translate(0, 0) scale(1); }
          100% { transform: translate(-60px, -40px) scale(1.15); }
        }
        @keyframes aurora-drift-3 {
          0% { transform: translate(0, 0) scale(1); }
          100% { transform: translate(-40px, 50px) scale(1.1); }
        }
      `}</style>
    </div>
  )
}
