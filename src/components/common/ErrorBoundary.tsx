import { Component, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

interface Props { children: ReactNode; }
interface State { hasError: boolean; error?: Error; }

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // Surface the real error so we can diagnose crashes in production
    // (visible in the browser console / remote logs).
    console.error('[ErrorBoundary] captured render error:', error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      // Read language from localStorage to determine which text to show
      const lang = (typeof window !== 'undefined' && localStorage.getItem('quantaex_lang')) || 'en';
      const isKo = lang === 'ko';

      return (
        <div className="min-h-[50vh] flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 bg-exchange-sell/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">!</span>
            </div>
            <h2 className="text-xl font-bold mb-2 text-exchange-text">
              {isKo ? '\uc624\ub958\uac00 \ubc1c\uc0dd\ud588\uc2b5\ub2c8\ub2e4' : 'Something went wrong'}
            </h2>
            <p className="text-sm text-exchange-text-secondary mb-6">
              {isKo
                ? '\ud398\uc774\uc9c0\ub97c \ubd88\ub7ec\uc624\ub294 \uc911 \ubb38\uc81c\uac00 \uc0dd\uacbc\uc2b5\ub2c8\ub2e4. \uc0c8\ub85c\uace0\uce68\uc744 \uc2dc\ub3c4\ud574\uc8fc\uc138\uc694.'
                : 'An error occurred while loading the page. Please try refreshing.'}
            </p>
            <button
              onClick={() => { this.handleReset(); window.location.reload(); }}
              className="btn-primary !py-2.5 !px-6 text-sm rounded-lg inline-flex items-center gap-2"
            >
              <RefreshCw size={16} /> {isKo ? '\uc0c8\ub85c\uace0\uce68' : 'Refresh'}
            </button>
            {this.state.error && (
              <details className="mt-6 text-left">
                <summary className="text-xs text-exchange-text-third cursor-pointer select-none">
                  {isKo ? '\uc624\ub958 \uc0c1\uc138 (\uac1c\ubc1c\uc790\uc6a9)' : 'Error details (for support)'}
                </summary>
                <pre className="mt-2 text-[11px] leading-snug text-exchange-sell whitespace-pre-wrap break-words max-h-48 overflow-auto p-2 rounded bg-exchange-input">
                  {String(this.state.error?.message || this.state.error)}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
