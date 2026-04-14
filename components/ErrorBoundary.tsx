'use client'

import { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: React.ErrorInfo | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
    this.setState({ error, errorInfo })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="p-6 bg-destructive/10 border border-destructive rounded-lg">
          <h2 className="text-lg font-bold text-destructive mb-2">Something went wrong</h2>
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold">Error details</summary>
            <div className="mt-2 text-xs">
              <p className="font-mono text-red-600">{this.state.error?.toString()}</p>
              {this.state.errorInfo && (
                <pre className="mt-2 overflow-auto text-muted-foreground bg-background p-2 rounded">
                  {this.state.errorInfo.componentStack}
                </pre>
              )}
            </div>
          </details>
        </div>
      )
    }

    return this.props.children
  }
}
