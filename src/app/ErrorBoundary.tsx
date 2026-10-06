import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CircleAlert } from "lucide-react";
import { appLog } from "@/lib/platform/log";
import "./error-boundary.css";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  message: string;
  stack: string;
  componentStack: string;
  copied: boolean;
}

function buildDiagnostics(state: ErrorBoundaryState): string {
  const stack = state.stack.length > 0 ? `\n\n${state.stack}` : "";
  const componentStack =
    state.componentStack.length > 0 ? `\n\nComponent stack:\n${state.componentStack}` : "";
  return `${state.message}${stack}${componentStack}`;
}

function ErrorFallback({ state, onCopied }: { state: ErrorBoundaryState; onCopied: () => void }) {
  const { t } = useTranslation();
  const copy = (): void => {
    navigator.clipboard
      .writeText(buildDiagnostics(state))
      .then(onCopied)
      .catch(() => undefined);
  };
  return (
    <div className="error-boundary">
      <div className="error-boundary-card" role="alert">
        <h2 className="error-boundary-title">
          <CircleAlert size={18} aria-hidden="true" />
          <span>{t("core.errors.title")}</span>
        </h2>
        <p className="error-boundary-note">{t("core.errors.body")}</p>
        <pre className="error-boundary-detail">{state.message}</pre>
        <div className="error-boundary-actions">
          {state.copied ? (
            <span className="error-boundary-copied" role="status">
              {t("core.errors.copied")}
            </span>
          ) : null}
          <button type="button" className="error-boundary-button" onClick={copy}>
            {t("core.errors.copy_diagnostics")}
          </button>
          <button
            type="button"
            className="error-boundary-button"
            onClick={() => window.location.reload()}
          >
            {t("core.errors.reload")}
          </button>
        </div>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    message: "",
    stack: "",
    componentStack: "",
    copied: false,
  };

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({
      message: `${error.name}: ${error.message}`,
      stack: error.stack ?? "",
      componentStack: errorInfo.componentStack ?? "",
      copied: false,
    });
    const stack = error.stack ?? "";
    void appLog(
      "error",
      stack.length > 0
        ? `${error.name}: ${error.message}\n${stack}`
        : `${error.name}: ${error.message}`,
    );
  }

  private handleCopied = (): void => {
    this.setState((state) => ({ ...state, copied: true }));
  };

  render(): ReactNode {
    if (this.state.message.length > 0) {
      return <ErrorFallback state={this.state} onCopied={this.handleCopied} />;
    }
    return this.props.children;
  }
}
