'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Send, Loader2, Plus, Trash2, AlertCircle, User as UserIcon, Bot, Mic, MicOff } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { PhilReportDownload, isPhilReport, type PhilReport } from './PhilReportDownload'

interface Message {
  id?: string
  role: 'user' | 'assistant'
  content: string
  report?: PhilReport | null
  model?: string | null
  latency_ms?: number | null
  error?: string | null
  created_at?: string
  pending?: boolean
  pendingPhase?: 'loading_history' | 'thinking' | 'querying' | undefined
}

interface Props {
  userId: string
}

const STORAGE_KEY = 'phil:sessionId'

function newSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function loadSessionId(): string {
  if (typeof window === 'undefined') return newSessionId()
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored) return stored
  const fresh = newSessionId()
  window.localStorage.setItem(STORAGE_KEY, fresh)
  return fresh
}

function saveSessionId(sid: string) {
  if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, sid)
}

function errorKey(detail: string | undefined, status: number | undefined): string {
  if (status === 401 || status === 403 || detail === 'bridge_unauthorized') return 'phil.error.unauthorized'
  if (status === 429 || detail === 'rate_limit') return 'phil.error.rateLimit'
  if (status === 504 || detail === 'timeout' || detail === 'codex_timeout') return 'phil.error.timeout'
  if (status === 503 || detail === 'bridge_not_configured' || detail === 'empty_answer') return 'phil.error.bridgeDown'
  if (status === 502 || detail === 'bridge_error') return 'phil.error.bridgeDown'
  return 'phil.error.generic'
}

export function PhilChat({ userId }: Props) {
  const { t, language } = useI18n()
  const [sessionId, setSessionId] = useState<string>(() => loadSessionId())
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [bannerError, setBannerError] = useState<string | null>(null)
  const [micState, setMicState] = useState<'idle' | 'listening' | 'unsupported'>('idle')
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const recognitionRef = useRef<any>(null)
  const baseInputRef = useRef<string>('')

  // Load history on mount + when sessionId changes
  useEffect(() => {
    let cancelled = false
    setLoadingHistory(true)
    fetch(`/api/chat/phil?sessionId=${encodeURIComponent(sessionId)}`, {
      headers: { 'x-user-id': userId },
    })
      .then(async (res) => {
        if (cancelled) return
        if (!res.ok) {
          setMessages([])
          return
        }
        const data = await res.json()
        if (cancelled) return
        if (data.sessionId && data.sessionId !== sessionId) {
          setSessionId(data.sessionId)
          saveSessionId(data.sessionId)
        }
        setMessages(
          (data.messages ?? []).map((m: Record<string, unknown>) => ({
            id: m.id as string | undefined,
            role: m.role as 'user' | 'assistant',
            content: (m.content as string) ?? '',
            report: (m.report as PhilReport | null) ?? null,
            model: (m.model as string | null) ?? null,
            latency_ms: (m.latency_ms as number | null) ?? null,
            error: (m.error as string | null) ?? null,
            created_at: m.created_at as string | undefined,
          })),
        )
      })
      .catch(() => {
        if (!cancelled) setMessages([])
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, userId])

  // Auto-scroll to bottom on new message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, sending])

  // Auto-grow textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      const h = Math.min(textareaRef.current.scrollHeight, 200)
      textareaRef.current.style.height = `${h}px`
    }
  }, [input])

  const send = useCallback(async () => {
    const question = input.trim()
    if (!question || sending) return
    setSending(true)
    setBannerError(null)
    const userMsg: Message = { role: 'user', content: question }
    const placeholder: Message = { role: 'assistant', content: '', pending: true, pendingPhase: 'thinking' }
    setMessages((prev) => [...prev, userMsg, placeholder])
    setInput('')

    const updatePlaceholder = (patch: Partial<Message>) => {
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = { ...next[next.length - 1], ...patch }
        return next
      })
    }

    try {
      const res = await fetch('/api/chat/phil', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ question, sessionId, language }),
      })

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}))
        const key = errorKey(data?.detail ?? data?.error, res.status)
        updatePlaceholder({ role: 'assistant', content: '', error: data?.detail ?? data?.error ?? 'error', pending: false })
        setBannerError(t(key))
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let resolved = false

      const handleEvent = (event: string, data: Record<string, unknown>) => {
        if (event === 'status') {
          const phase = data.phase as 'loading_history' | 'thinking' | undefined
          if (phase) updatePlaceholder({ pendingPhase: phase })
        } else if (event === 'result') {
          resolved = true
          if (data.sessionId && data.sessionId !== sessionId) {
            setSessionId(data.sessionId as string)
            saveSessionId(data.sessionId as string)
          }
          const report = isPhilReport(data.report) ? (data.report as PhilReport) : null
          updatePlaceholder({
            role: 'assistant',
            content: (data.answer as string) ?? '',
            report,
            model: (data.model as string) ?? null,
            latency_ms: (data.latencyMs as number) ?? null,
            pending: false,
            pendingPhase: undefined,
          })
        } else if (event === 'error') {
          resolved = true
          const status = (data.status as number | undefined) ?? 500
          const detail = (data.detail as string | undefined) ?? 'error'
          updatePlaceholder({ role: 'assistant', content: '', error: detail, pending: false, pendingPhase: undefined })
          setBannerError(t(errorKey(detail, status)))
        }
        // event === 'open' is ignored — just used to flush the first byte
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let idx
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          // SSE comment line starts with ':' — ignore (these are our keepalives)
          if (raw.startsWith(':')) continue
          let evName = 'message'
          let dataStr = ''
          for (const line of raw.split('\n')) {
            if (line.startsWith('event:')) evName = line.slice(6).trim()
            else if (line.startsWith('data:')) dataStr += (dataStr ? '\n' : '') + line.slice(5).trim()
          }
          if (!dataStr) continue
          let parsed: Record<string, unknown>
          try { parsed = JSON.parse(dataStr) } catch { continue }
          handleEvent(evName, parsed)
        }
      }

      if (!resolved) {
        updatePlaceholder({ role: 'assistant', content: '', error: 'stream_ended', pending: false, pendingPhase: undefined })
        setBannerError(t('phil.error.generic'))
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'network_error'
      updatePlaceholder({ role: 'assistant', content: '', error: detail, pending: false, pendingPhase: undefined })
      setBannerError(t('phil.error.generic'))
    } finally {
      setSending(false)
    }
  }, [input, sending, sessionId, userId, language, t])

  const startNewChat = useCallback(() => {
    const fresh = newSessionId()
    setSessionId(fresh)
    saveSessionId(fresh)
    setMessages([])
    setBannerError(null)
  }, [])

  const clearHistory = useCallback(async () => {
    if (!confirm(t('phil.clearHistoryConfirm'))) return
    try {
      await fetch('/api/chat/phil', {
        method: 'DELETE',
        headers: { 'x-user-id': userId },
      })
    } finally {
      startNewChat()
    }
  }, [userId, t, startNewChat])

  // --- Voice dictation via the browser Web Speech API ---
  // No Whisper / OpenAI key needed (Simon's key lacks model.request scope
  // as of 2026-05-18). Falls back to "unsupported" if SpeechRecognition is
  // missing (Firefox, older browsers). Real-time interim transcription
  // appends to whatever was already in the textarea so dictation augments
  // typed text rather than replacing it.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      setMicState('unsupported')
    }
  }, [])

  const stopDictation = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {}
      recognitionRef.current = null
    }
    setMicState('idle')
  }, [])

  const startDictation = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      setMicState('unsupported')
      setBannerError(t('phil.mic.unsupported'))
      return
    }
    if (recognitionRef.current) {
      stopDictation()
      return
    }
    const rec = new SR()
    rec.lang = language === 'es' ? 'es-MX' : 'en-US'
    rec.interimResults = true
    rec.continuous = true
    rec.maxAlternatives = 1
    baseInputRef.current = input  // remember what was already typed
    setBannerError(null)
    rec.onresult = (event: any) => {
      let finalText = ''
      let interimText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) finalText += transcript
        else interimText += transcript
      }
      // Append-mode: keep typed text + dictated final + interim preview
      const base = baseInputRef.current ? baseInputRef.current.replace(/\s+$/, '') + ' ' : ''
      const merged = (base + finalText + interimText).replace(/\s+/g, ' ').trimStart()
      setInput(merged)
      // commit final pieces into the base so the next interim doesn't double them
      if (finalText) {
        baseInputRef.current = (base + finalText).replace(/\s+/g, ' ').trim()
      }
    }
    rec.onerror = (event: any) => {
      const err = event?.error || 'unknown'
      stopDictation()
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        setBannerError(t('phil.mic.denied'))
      } else if (err === 'no-speech') {
        setBannerError(t('phil.mic.noSpeech'))
      } else if (err === 'audio-capture') {
        setBannerError(t('phil.mic.noMicrophone'))
      } else if (err !== 'aborted') {
        setBannerError(t('phil.mic.error'))
      }
    }
    rec.onend = () => {
      // Browser ended the session (timeout or stop()). Drop state to idle.
      recognitionRef.current = null
      setMicState('idle')
    }
    try {
      rec.start()
      recognitionRef.current = rec
      setMicState('listening')
    } catch (err) {
      // start() throws if called twice; reset
      try { rec.abort() } catch {}
      recognitionRef.current = null
      setMicState('idle')
      setBannerError(t('phil.mic.error'))
    }
  }, [language, input, t, stopDictation])

  // Cleanup on unmount
  useEffect(() => () => stopDictation(), [stopDictation])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Skip Enter while IME composition is active (Japanese/Chinese/Korean)
      if (e.nativeEvent.isComposing) return
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void send()
      }
    },
    [send],
  )

  const examples = useMemo(() => [
    t('phil.empty.example1'),
    t('phil.empty.example2'),
    t('phil.empty.example3'),
  ], [t])

  const isEmpty = !loadingHistory && messages.length === 0

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* Action bar */}
      <div className="flex items-center justify-end gap-1 border-b px-3 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={startNewChat}
          title={t('phil.newChat')}
        >
          <Plus className="size-3.5" />
          <span>{t('phil.newChat')}</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={clearHistory}
          title={t('phil.clearHistory')}
          className="hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
          <span>{t('phil.clearHistory')}</span>
        </Button>
      </div>

      {/* Message list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4">
        {loadingHistory && (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            <Loader2 className="mr-2 size-3.5 animate-spin" />
            {t('phil.thinking')}
          </div>
        )}

        {isEmpty && (
          <div className="mx-auto mt-12 max-w-md text-center">
            <Bot className="mx-auto size-10 text-muted-foreground" />
            <h2 className="mt-3 text-base font-semibold text-foreground">{t('phil.empty.title')}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t('phil.empty.body')}</p>
            <div className="mt-5 flex flex-col gap-1.5">
              {examples.map((ex, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setInput(ex)}
                  className="rounded-md border bg-card px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {messages.map((msg, i) => (
            <MessageBubble key={msg.id ?? `m-${i}`} msg={msg} t={t} />
          ))}
        </div>
      </div>

      {bannerError && (
        <div className="mx-3 mb-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{bannerError}</span>
        </div>
      )}

      {/* Input */}
      <div className="border-t px-3 py-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          {micState !== 'unsupported' && (
            <Button
              type="button"
              size="lg"
              variant={micState === 'listening' ? 'destructive' : 'outline'}
              onClick={micState === 'listening' ? stopDictation : startDictation}
              disabled={sending}
              className={
                'h-11 ' +
                (micState === 'listening' ? 'animate-pulse' : '')
              }
              aria-label={micState === 'listening' ? t('phil.mic.stop') : t('phil.mic.start')}
              title={micState === 'listening' ? t('phil.mic.stop') : t('phil.mic.start')}
            >
              {micState === 'listening' ? <MicOff className="size-4" /> : <Mic className="size-4" />}
            </Button>
          )}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={micState === 'listening' ? t('phil.mic.listening') : t('phil.placeholder')}
            aria-label={t('phil.placeholder')}
            rows={1}
            disabled={sending}
            className="min-h-[44px] flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          />
          <Button
            type="button"
            size="lg"
            onClick={() => void send()}
            disabled={sending || !input.trim()}
            className="h-11"
          >
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            <span className="hidden sm:inline">{t('phil.send')}</span>
          </Button>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ msg, t }: { msg: Message; t: (key: string) => string }) {
  const isUser = msg.role === 'user'
  const Icon = isUser ? UserIcon : Bot

  if (msg.pending) {
    const phaseKey =
      msg.pendingPhase === 'loading_history' ? 'phil.status.loadingHistory'
      : msg.pendingPhase === 'querying' ? 'phil.status.querying'
      : 'phil.thinking'
    return (
      <div className="flex gap-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
          <Bot className="size-3.5 text-muted-foreground" />
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-card px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          <span>{t(phaseKey)}</span>
        </div>
      </div>
    )
  }

  if (msg.error && !msg.content) {
    return (
      <div className="flex gap-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-destructive/20">
          <AlertCircle className="size-3.5 text-destructive" />
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {msg.error}
        </div>
      </div>
    )
  }

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`flex size-7 shrink-0 items-center justify-center rounded-full ${
          isUser ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
        }`}
      >
        <Icon className="size-3.5" />
      </div>
      <div className={`flex max-w-[85%] flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed ${
            isUser
              ? 'bg-primary/15 text-foreground'
              : 'border bg-card text-foreground'
          }`}
        >
          {msg.content}
        </div>
        {msg.report && <PhilReportDownload report={msg.report} />}
        {!isUser && msg.latency_ms != null && (
          <span className="text-[10px] text-muted-foreground">
            {msg.model ?? 'gpt-5.5'} · {(msg.latency_ms / 1000).toFixed(1)}s
          </span>
        )}
      </div>
    </div>
  )
}
