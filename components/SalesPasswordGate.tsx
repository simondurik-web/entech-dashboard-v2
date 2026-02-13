'use client'

import { useState, useEffect, FormEvent } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Lock } from 'lucide-react'

function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return hash
}

const SALES_HASH = 2001594324

export default function SalesPasswordGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [shake, setShake] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    if (sessionStorage.getItem('salesUnlocked') === 'true') {
      setUnlocked(true)
    }
  }, [])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (hashCode(password) === SALES_HASH) {
      sessionStorage.setItem('salesUnlocked', 'true')
      setUnlocked(true)
    } else {
      setError(true)
      setShake(true)
      setTimeout(() => setShake(false), 500)
    }
  }

  if (!mounted) return null
  if (unlocked) return <>{children}</>

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <Card className={`w-full max-w-sm mx-4 ${shake ? 'animate-shake' : ''}`}>
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Lock className="h-6 w-6 text-muted-foreground" />
          </div>
          <CardTitle>Sales Access</CardTitle>
          <p className="text-sm text-muted-foreground">Enter password to view sales data</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(false) }}
                autoFocus
              />
              {error && <p className="text-sm text-destructive mt-1">Incorrect password</p>}
            </div>
            <Button type="submit" className="w-full">Unlock</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
