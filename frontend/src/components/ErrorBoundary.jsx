import React from 'react';
import { RefreshCw, Home, AlertTriangle } from 'lucide-react';
import { captureError } from '../utils/errorReporter';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    captureError(error, { componentStack: errorInfo?.componentStack, boundary: this.props.name || 'ErrorBoundary' });
  }

  render() {
    if (this.state.hasError) {
      const { error } = this.state;
      return (
        <div className="card-elevated error-fallback" style={{ textAlign: 'center', padding: '40px', minHeight: '200px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <AlertTriangle size={48} style={{ color: 'var(--color-warning)', marginBottom: '16px' }} />
          <h2 style={{ color: 'var(--text-primary)', marginBottom: '8px' }}>Something went wrong</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', maxWidth: '400px' }}>
            {error?.message || 'An unexpected error occurred.'}
          </p>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="btn btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <RefreshCw size={16} /> Try Again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="btn btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <Home size={16} /> Full Reload
            </button>
          </div>
          {import.meta.env.DEV && error && (
            <details style={{ marginTop: '24px', textAlign: 'left', maxWidth: '500px', width: '100%' }}>
              <summary style={{ color: 'var(--text-muted)', cursor: 'pointer', fontSize: '12px' }}>Error Details</summary>
              <pre style={{ marginTop: '12px', padding: '12px', background: 'var(--bg-canvas)', borderRadius: '8px', fontSize: '11px', overflow: 'auto', color: 'var(--text-secondary)' }}>
                {error.stack || error.toString()}
              </pre>
            </details>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
