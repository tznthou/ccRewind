import { Component, type ErrorInfo, type ReactNode } from 'react'
import { formatError, type FormattedError } from './errorFormat'

interface ErrorBoundaryProps {
  children: ReactNode
  /**
   * 出錯時顯示什麼。用 render prop 而非 ReactNode，是因為 class component 不能用 hook，
   * 文字要走 i18n 只能由呼叫端（function component）提供。
   */
  fallback: (error: FormattedError) => ReactNode
  /** 寫進 console 的辨識標籤，讓使用者回報時能回推是哪個區塊壞掉 */
  label?: string
}

interface ErrorBoundaryState {
  error: FormattedError | null
}

/**
 * 攔截子樹的 render 錯誤，避免單一元件拋錯就整個 app 白屏。
 *
 * 沒有內建重置機制——要在特定 prop 變化時重來，由呼叫端給 `key`（React 會重建元件）。
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: formatError(error) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    const tag = this.props.label ? `ErrorBoundary:${this.props.label}` : 'ErrorBoundary'
    console.error(`[${tag}]`, error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    return error ? this.props.fallback(error) : this.props.children
  }
}
