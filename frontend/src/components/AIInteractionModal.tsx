import { useState } from "react";
import { createPortal } from "react-dom";
import type { ScheduleRun } from "../types";

type Tab = "system" | "user" | "response";

interface AIInteractionModalProps {
  run: ScheduleRun;
  onClose: () => void;
}

const formatResponse = (raw: string): string => {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return raw;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
};

const renderPromptContent = (text: string) => {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    if (line.startsWith("## ")) {
      return <span key={i} className="ai-prompt-heading">{line}{"\n"}</span>;
    }
    if (line.startsWith("- ") || line.startsWith("  - ")) {
      return <span key={i} className="ai-prompt-list-item">{line}{"\n"}</span>;
    }
    return <span key={i}>{line}{"\n"}</span>;
  });
};

const AIInteractionModal = ({ run, onClose }: AIInteractionModalProps) => {
  const [activeTab, setActiveTab] = useState<Tab>("user");

  const tabs: { id: Tab; label: string; content: string | null | undefined }[] = [
    { id: "system", label: "System Prompt", content: run.systemPrompt },
    { id: "user", label: "User Prompt", content: run.userPrompt },
    { id: "response", label: "AI Response", content: run.rawResponse }
  ];

  const activeContent = tabs.find((t) => t.id === activeTab)?.content;

  const formattedResponse =
    activeTab !== "response" || !run.rawResponse
      ? null
      : formatResponse(run.rawResponse);

  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="modal-content ai-interaction-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header ai-interaction-modal__header">
          <div>
            <h2>AI Interaction</h2>
            <p className="ai-interaction-modal__meta muted">
              {run.requestParams?.provider ?? run.aiProvider} / {run.requestParams?.model ?? run.aiModel}
              {run.promptTokens != null && run.completionTokens != null && (
                <span> · {run.promptTokens.toLocaleString()} + {run.completionTokens.toLocaleString()} tokens</span>
              )}
              {run.requestParams?.maxTokens && (
                <span> · max {run.requestParams.maxTokens}</span>
              )}
            </p>
          </div>
          <button
            type="button"
            className="ghost-button icon-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </header>

        <div className="ai-interaction-modal__tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`ai-interaction-modal__tab${activeTab === tab.id ? " ai-interaction-modal__tab--active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              {!tab.content && <span className="muted"> (empty)</span>}
            </button>
          ))}
        </div>

        <div className="ai-interaction-modal__content">
          {activeContent ? (
            <pre className="ai-interaction-modal__pre">
              {activeTab === "response" && formattedResponse
                ? formattedResponse
                : renderPromptContent(activeContent)}
            </pre>
          ) : (
            <p className="muted ai-interaction-modal__empty">No data available for this section.</p>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default AIInteractionModal;
