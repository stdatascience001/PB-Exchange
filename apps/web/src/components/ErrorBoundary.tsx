import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// React treats an exception thrown during render as unrecoverable and unmounts the whole
// tree, so one bad field on one card used to leave the entire app as a blank black page
// (e.g. `s.netAmount.toLocaleString()` on a shift whose netAmount the API didn't send).
// This boundary keeps that contained: the user still sees a real message with a way out,
// instead of a blank screen and a console stack they can't act on.
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep the original stack in the console — this boundary must not make a crash harder
    // to diagnose than it was before.
    console.error('[UI crash]', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen bg-[#eaedf2] flex items-center justify-center p-6 font-sans">
        <div className="bg-white rounded-md shadow-sm border border-slate-300 max-w-lg w-full p-5 text-slate-800">
          <div className="text-sm font-bold text-rose-700 mb-1">Something went wrong on this screen</div>
          <p className="text-xs text-slate-600 mb-3">
            The rest of the application is fine. Reload to continue, and report this message if it keeps happening.
          </p>
          <pre className="text-[11px] bg-slate-50 border border-slate-200 rounded p-2 overflow-auto max-h-40 text-rose-800 whitespace-pre-wrap">
            {error.message}
          </pre>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded shadow-xs"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs rounded"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
}
