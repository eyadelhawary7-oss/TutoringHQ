'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import * as Sentry from '@sentry/nextjs';

type Props = { children: ReactNode };

type State = { error: Error | null };

const seenFingerprints = new Set<string>();

function stackFingerprint(error: Error): string {
  const stack = error.stack ?? '';
  const frame =
    stack
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith('at ') || l.includes('@')) ?? 'no-frame';
  return frame.slice(0, 240);
}

function isHydrationNoise(error: Error): boolean {
  const m = (error.message ?? '').toLowerCase();
  return (
    m.includes('hydration') ||
    m.includes('418') ||
    m.includes('did not match') ||
    m.includes('text content does not match')
  );
}

export class HydrationBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    if (isHydrationNoise(error)) {
      const fp = stackFingerprint(error);
      if (!seenFingerprints.has(fp)) {
        seenFingerprints.add(fp);
        Sentry.captureMessage('React hydration mismatch (#418)', {
          level: 'warning',
          fingerprint: ['react-hydration-418', fp],
          extra: {
            message: error.message,
            componentStack: errorInfo.componentStack,
          },
        });
      }
      return;
    }
    Sentry.captureException(error, { extra: { componentStack: errorInfo.componentStack } });
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-sm font-medium text-[var(--color-text-primary)]">
            This view could not sync with the server preview. Refresh to continue.
          </p>
          <button
            type="button"
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
