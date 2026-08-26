import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

export type ActionStatus = "idle" | "loading" | "success" | "error";

interface ActionButtonProps {
  icon: ReactNode;
  type?: "button" | "submit";
  variant?: "primary" | "ghost" | "danger";
  action?: () => Promise<void>;
  status?: ActionStatus;
  successLabel?: string;
  errorLabel?: string;
  feedbackDuration?: number;
  onFeedbackComplete?: () => void;
  disabled?: boolean;
  className?: string;
  idleClassName?: string;
  title?: string;
  "aria-label"?: string;
  onClick?: () => void;
}

const FEEDBACK_PAUSE = 300;

const SpinnerIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon-spin">
    <path d="M21 12a9 9 0 11-6.219-8.56" />
  </svg>
);

const SmallCheck = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const SmallX = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const ActionButton = ({
  icon,
  type = "button",
  variant = "primary",
  action,
  status: controlledStatus,
  successLabel,
  errorLabel,
  feedbackDuration = 2000,
  onFeedbackComplete,
  disabled,
  className,
  idleClassName,
  title,
  "aria-label": ariaLabel,
  onClick,
}: ActionButtonProps) => {
  const [internalStatus, setInternalStatus] = useState<ActionStatus>("idle");
  const timeoutRef = useRef<number>(undefined);
  const mountedRef = useRef(true);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const currentStatus = controlledStatus ?? internalStatus;

  const prevStatusRef = useRef<ActionStatus>("idle");

  // Hold the latest `onFeedbackComplete` in a ref (synced after every commit)
  // so the feedback-timer effect below can depend only on the *status*. Without
  // this, an inline callback (new identity each render) would re-run that effect
  // and restart the timer on every parent render — so success/error might never
  // time out. Same latest-ref pattern as `useActionStatus`.
  const onFeedbackCompleteRef = useRef(onFeedbackComplete);
  useEffect(() => {
    onFeedbackCompleteRef.current = onFeedbackComplete;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = currentStatus;
    if (currentStatus === "idle" && prev !== "idle") {
      requestAnimationFrame(() => buttonRef.current?.focus());
    }
  }, [currentStatus]);

  useEffect(() => {
    if (controlledStatus === "success" || controlledStatus === "error") {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => {
        const done = onFeedbackCompleteRef.current;
        if (done) {
          window.setTimeout(() => {
            if (mountedRef.current) done();
          }, FEEDBACK_PAUSE);
        }
      }, feedbackDuration);
    }
    // Depends only on the status transition — the callback is read from a ref.
  }, [controlledStatus, feedbackDuration]);

  const handleClick = useCallback(async () => {
    if (action) {
      setInternalStatus("loading");
      try {
        await action();
        if (!mountedRef.current) return;
        setInternalStatus("success");
        clearTimeout(timeoutRef.current);
        timeoutRef.current = window.setTimeout(() => {
          if (!mountedRef.current) return;
          setInternalStatus("idle");
          if (onFeedbackComplete) {
            window.setTimeout(() => {
              if (mountedRef.current) onFeedbackComplete();
            }, FEEDBACK_PAUSE);
          }
        }, feedbackDuration);
      } catch {
        if (!mountedRef.current) return;
        setInternalStatus("error");
        clearTimeout(timeoutRef.current);
        timeoutRef.current = window.setTimeout(() => {
          if (!mountedRef.current) return;
          setInternalStatus("idle");
          if (onFeedbackComplete) {
            window.setTimeout(() => {
              if (mountedRef.current) onFeedbackComplete();
            }, FEEDBACK_PAUSE);
          }
        }, feedbackDuration);
      }
    } else if (onClick) {
      onClick();
    }
  }, [action, onClick, feedbackDuration, onFeedbackComplete]);

  const variantClass =
    variant === "primary" ? "primary-button"
    : variant === "danger" ? "danger-button"
    : "ghost-button";

  const statusClass =
    currentStatus === "success" ? "action-btn--success"
    : currentStatus === "error" ? "action-btn--error"
    : "";

  const classes = [
    "icon-btn",
    variantClass,
    statusClass,
    currentStatus === "idle" ? idleClassName : "",
    className,
  ].filter(Boolean).join(" ");

  const isDisabled = disabled || currentStatus === "loading" || currentStatus === "success" || currentStatus === "error";

  const renderContent = () => {
    switch (currentStatus) {
      case "loading":
        return <SpinnerIcon />;
      case "success":
        return (
          <>
            <SmallCheck />
            {successLabel && <span className="action-btn__label">{successLabel}</span>}
          </>
        );
      case "error":
        return (
          <>
            <SmallX />
            {errorLabel && <span className="action-btn__label">{errorLabel}</span>}
          </>
        );
      default:
        return icon;
    }
  };

  return (
    <button
      ref={buttonRef}
      type={type}
      className={classes}
      disabled={isDisabled}
      title={title}
      aria-label={ariaLabel}
      onClick={action || onClick ? (e) => { if (action) { e.preventDefault(); void handleClick(); } else if (onClick) { onClick(); } } : undefined}
    >
      {renderContent()}
    </button>
  );
};

export default ActionButton;

export function useActionStatus(feedbackDuration = 2000, onFeedbackComplete?: () => void) {
  const [status, setStatus] = useState<ActionStatus>("idle");
  const timeoutRef = useRef<number>(undefined);
  const mountedRef = useRef(true);
  const onFeedbackCompleteRef = useRef(onFeedbackComplete);
  // Keep the latest callback in a ref without writing during render (compiler
  // `refs` rule); a no-dep effect runs after every commit.
  useEffect(() => {
    onFeedbackCompleteRef.current = onFeedbackComplete;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(timeoutRef.current);
    };
  }, []);

  const wrap = useCallback(async (fn: () => Promise<void>) => {
    setStatus("loading");
    try {
      await fn();
      if (!mountedRef.current) return;
      setStatus("success");
      clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => {
        if (!mountedRef.current) return;
        setStatus("idle");
        if (onFeedbackCompleteRef.current) {
          window.setTimeout(() => {
            if (mountedRef.current) onFeedbackCompleteRef.current?.();
          }, FEEDBACK_PAUSE);
        }
      }, feedbackDuration);
    } catch (e) {
      if (!mountedRef.current) return;
      setStatus("error");
      clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => {
        if (!mountedRef.current) return;
        setStatus("idle");
        if (onFeedbackCompleteRef.current) {
          window.setTimeout(() => {
            if (mountedRef.current) onFeedbackCompleteRef.current?.();
          }, FEEDBACK_PAUSE);
        }
      }, feedbackDuration);
      throw e;
    }
  }, [feedbackDuration]);

  return { status, wrap } as const;
}

export const CheckIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const XIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export const TrashIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
  </svg>
);

export const TestIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

export const PlayIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

export const ErrorCircleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
  </svg>
);
