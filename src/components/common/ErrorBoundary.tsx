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
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
