'use client'

/**
 * OAuth consent screen for MCP clients (Gemini, ChatGPT, Grok, Claude).
 * The AI app sends the user here with client_id/redirect_uri/state/PKCE
 * params; we require a dashboard Google sign-in, confirm the user has MCP
 * access, and on Approve exchange the params for an authorization code via
 * /api/mcp-oauth/approve, then bounce back to the AI app.
 */

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { authHeaders } from '@/lib/session-token'
import { useI18n } from '@/lib/i18n'
import { LogIn, ShieldCheck, ShieldX, Loader2 } from 'lucide-react'

type ConsentState =
  | { phase: 'loading' }
  | { phase: 'invalid'; reason: string }
  | { phase: 'need-login' }
  | { phase: 'no-access' }
  | { phase: 'ready'; clientName: string }
  | { phase: 'approving' }
  | { phase: 'error'; message: string }

function AuthorizeInner() {
  const params = useSearchParams()
  const { user, loading: authLoading, signIn } = useAuth()
  const { t } = useI18n()
  const [state, setState] = useState<ConsentState>({ phase: 'loading' })

  const clientId = params.get('client_id') ?? ''
  const redirectUri = params.get('redirect_uri') ?? ''
  const stateParam = params.get('state') ?? ''
  const codeChallenge = params.get('code_challenge') ?? ''
  const codeChallengeMethod = params.get('code_challenge_method') ?? 'S256'

  useEffect(() => {
    if (authLoading) return
    if (!clientId || !redirectUri || !codeChallenge) {
      setState({ phase: 'invalid', reason: 'missing_params' })
      return
    }
    let cancelled = false
    const check = async () => {
      const qs = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri })
      const res = await fetch(`/api/mcp-oauth/approve?${qs}`, { headers: authHeaders() })
      const data = await res.json().catch(() => ({ valid: false, reason: 'network' }))
      if (cancelled) return
      if (!data.valid) {
        setState({ phase: 'invalid', reason: data.reason ?? 'invalid_request' })
      } else if (!user) {
        setState({ phase: 'need-login' })
      } else if (data.allowed === false) {
        setState({ phase: 'no-access' })
      } else {
        setState({ phase: 'ready', clientName: data.client_name })
      }
    }
    check()
    return () => {
      cancelled = true
    }
  }, [authLoading, user, clientId, redirectUri, codeChallenge])

  const approve = useCallback(async () => {
    setState({ phase: 'approving' })
    const res = await fetch('/api/mcp-oauth/approve', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        client_id: clientId,
        redirect_uri: redirectUri,
        state: stateParam,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok && data.redirect) {
      window.location.href = data.redirect
    } else {
      setState({ phase: 'error', message: data.error ?? `Request failed (${res.status})` })
    }
  }, [clientId, redirectUri, stateParam, codeChallenge, codeChallengeMethod])

  const deny = useCallback(() => {
    try {
      const url = new URL(redirectUri)
      url.searchParams.set('error', 'access_denied')
      if (stateParam) url.searchParams.set('state', stateParam)
      window.location.href = url.toString()
    } catch {
      window.history.back()
    }
  }, [redirectUri, stateParam])

  // Google OAuth round-trips through Supabase and lands back on this exact
  // URL (query params included), so the consent context survives the login.
  const signInHere = useCallback(async () => {
    await signIn(window.location.href)
  }, [signIn])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10">
            <ShieldCheck className="size-6 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold">{t('mcp.consentTitle')}</h1>
            <p className="text-xs text-muted-foreground">Entech Molding Dashboard</p>
          </div>
        </div>

        {(state.phase === 'loading' || authLoading || state.phase === 'approving') && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {state.phase === 'approving' ? t('mcp.connecting') : t('ui.loading')}
          </div>
        )}

        {state.phase === 'invalid' && !authLoading && (
          <div className="py-4">
            <div className="mb-2 flex items-center gap-2 text-destructive">
              <ShieldX className="size-5" />
              <p className="font-semibold">{t('mcp.invalidRequest')}</p>
            </div>
            <p className="text-sm text-muted-foreground">
              {t('mcp.invalidRequestDetail')} ({state.reason})
            </p>
          </div>
        )}

        {state.phase === 'need-login' && !authLoading && (
          <div className="py-4">
            <p className="mb-4 text-sm text-muted-foreground">{t('mcp.signInPrompt')}</p>
            <button
              onClick={signInHere}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <LogIn className="size-4" />
              {t('mcp.signInGoogle')}
            </button>
          </div>
        )}

        {state.phase === 'no-access' && (
          <div className="py-4">
            <div className="mb-2 flex items-center gap-2 text-destructive">
              <ShieldX className="size-5" />
              <p className="font-semibold">{t('mcp.noAccessTitle')}</p>
            </div>
            <p className="text-sm text-muted-foreground">{t('mcp.noAccessDetail')}</p>
          </div>
        )}

        {state.phase === 'ready' && (
          <div className="py-2">
            <p className="mb-1 text-sm">
              <span className="font-semibold">{state.clientName}</span> {t('mcp.consentAsk')}
            </p>
            {/* Anti-phishing: names are self-declared at registration, so always
                show WHERE the authorization actually goes. */}
            <p className="mb-1 text-xs text-muted-foreground">
              {t('mcp.consentRedirectsTo')}{' '}
              <span className="font-mono font-medium">
                {(() => {
                  try {
                    return new URL(redirectUri).host
                  } catch {
                    return redirectUri
                  }
                })()}
              </span>
            </p>
            <p className="mb-4 text-xs text-muted-foreground">
              {t('mcp.consentSignedInAs')} <span className="font-medium">{user?.email}</span>
            </p>
            <ul className="mb-6 space-y-1.5 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              <li>✓ {t('mcp.scopeOrders')}</li>
              <li>✓ {t('mcp.scopeInventory')}</li>
              <li>✓ {t('mcp.scopeShipping')}</li>
              <li className="pt-1 font-medium text-foreground">🔒 {t('mcp.readOnlyNote')}</li>
            </ul>
            <div className="flex gap-3">
              <button
                onClick={deny}
                className="flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
              >
                {t('ui.cancel')}
              </button>
              <button
                onClick={approve}
                className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {t('mcp.approve')}
              </button>
            </div>
          </div>
        )}

        {state.phase === 'error' && (
          <div className="py-4">
            <div className="mb-2 flex items-center gap-2 text-destructive">
              <ShieldX className="size-5" />
              <p className="font-semibold">{t('mcp.errorTitle')}</p>
            </div>
            <p className="text-sm text-muted-foreground">{state.message}</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default function McpAuthorizePage() {
  return (
    <Suspense fallback={null}>
      <AuthorizeInner />
    </Suspense>
  )
}
