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
      return (
        <div className="min-h-[50vh] flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 bg-exchange-sell/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">!</span>
            </div>
            <h2 className="text-xl font-bold mb-2 text-exchange-text">오류가 발생했습니다</h2>
            <p className="text-sm text-exchange-text-secondary mb-6">
              페이지를 불러오는 중 문제가 생겼습니다. 새로고침을 시도해주세요.
            </p>
            <button
              onClick={() => { this.handleReset(); window.location.reload(); }}
              className="btn-primary !py-2.5 !px-6 text-sm rounded-lg inline-flex items-center gap-2"
            >
              <RefreshCw size={16} /> 새로고침
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
