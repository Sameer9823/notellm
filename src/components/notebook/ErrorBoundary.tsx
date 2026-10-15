"use client";

import { Component, ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary for catching rendering errors in the workspace.
 * Provides a retry mechanism and error display.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="flex h-full w-full items-center justify-center p-4">
          <div className="text-center space-y-4">
            <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
            <div>
              <h3 className="font-display text-lg font-semibold">Something went wrong</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {this.state.error?.message ?? "An unexpected error occurred"}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={this.handleRetry}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Try again
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Specialized error boundary for the PDF viewer and other heavy components.
 */
export function ViewerErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={
        <div className="flex h-full w-full items-center justify-center p-4">
          <div className="text-center space-y-4">
            <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
            <div>
              <h3 className="font-display text-lg font-semibold">Failed to load viewer</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                The content could not be displayed. Please try again or open in a new tab.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Reload page
            </Button>
          </div>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}

/**
 * Error boundary for the main workspace layout.
 */
export function WorkspaceErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={
        <div className="flex h-full w-full items-center justify-center p-4">
          <div className="text-center space-y-4">
            <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
            <div>
              <h3 className="font-display text-lg font-semibold">Workspace error</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                The notebook workspace failed to load. Please refresh the page.
              </p>
            </div>
            <Button variant="default" size="sm" onClick={() => window.location.reload()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Refresh page
            </Button>
          </div>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}