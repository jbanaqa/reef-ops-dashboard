"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const sources = [
  "Google Review",
  "Reddit",
  "Reef2Reef",
  "Facebook",
  "Instagram",
  "Email",
  "Phone Call",
  "Internal Staff Note",
  "Other",
];

type FeedbackAnalysis = {
  sentiment: string;
  issueTypes: string[];
  severity: string;
  validityEstimate: string;
  suggestedStatus: string;
  confidence: number;
  summary: string;
  suggestedNextAction: string;
  suggestedResponse: string;
  missingInformation: string[];
};

export default function NewFeedbackPage() {
  const router = useRouter();

  const [source, setSource] = useState("Google Review");
  const [sourceUrl, setSourceUrl] = useState("");
  const [customerReference, setCustomerReference] = useState("");
  const [feedbackText, setFeedbackText] = useState("");
  const [staffNote, setStaffNote] = useState("");

  const [analysis, setAnalysis] = useState<FeedbackAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleAnalyze() {
    if (!feedbackText.trim()) {
      alert("Please paste feedback text before analyzing.");
      return;
    }

    setIsAnalyzing(true);
    setErrorMessage("");
    setAnalysis(null);

    try {
      const response = await fetch("/api/feedback/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source,
          sourceUrl,
          customerReference,
          feedbackText,
          staffNote,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to analyze feedback.");
      }

      setAnalysis(data.analysis);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Something went wrong.";
      setErrorMessage(message);
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleSave() {
    if (!analysis) {
      alert("Please analyze the feedback before saving.");
      return;
    }

    setIsSaving(true);
    setErrorMessage("");

    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source,
          sourceUrl,
          customerReference,
          feedbackText,
          staffNote,
          analysis,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to save feedback.");
      }

      router.push("/feedback");
      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Something went wrong.";
      setErrorMessage(message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <section>
        <p className="page-header-eyebrow">Feedback Intelligence</p>
        <h2 className="page-title">Add Feedback</h2>
        <p className="page-description">
          Paste a review, forum post, customer complaint, email, or staff
          observation. The first version uses manual intake so we can validate
          the workflow before adding automated source monitoring.
        </p>
      </section>

      <div className="two-column-grid">
        <section className="card card-padded">
          <h3 className="card-title">Feedback Details</h3>

          <div className="form-stack">
            <div>
              <label className="form-label">Source</label>
              <select
                value={source}
                onChange={(event) => setSource(event.target.value)}
                className="form-select"
              >
                {sources.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="form-label">
                Source URL <span className="optional-text">(optional)</span>
              </label>
              <input
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                placeholder="https://..."
                className="form-input"
              />
            </div>

            <div>
              <label className="form-label">
                Customer / Order Reference{" "}
                <span className="optional-text">(optional)</span>
              </label>
              <input
                value={customerReference}
                onChange={(event) => setCustomerReference(event.target.value)}
                placeholder="Name, email, order number, or anything useful"
                className="form-input"
              />
            </div>

            <div>
              <label className="form-label">Feedback Text</label>
              <textarea
                value={feedbackText}
                onChange={(event) => setFeedbackText(event.target.value)}
                rows={8}
                placeholder="Paste the review, forum post, complaint, email, or staff observation here..."
                className="form-textarea"
              />
            </div>

            <div>
              <label className="form-label">
                Internal Staff Note{" "}
                <span className="optional-text">(optional)</span>
              </label>
              <textarea
                value={staffNote}
                onChange={(event) => setStaffNote(event.target.value)}
                rows={3}
                placeholder="Add any internal context staff already knows..."
                className="form-textarea"
              />
            </div>

            <div className="action-row">
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={isAnalyzing || isSaving}
                className="button button-primary"
              >
                {isAnalyzing ? "Analyzing..." : "Analyze Feedback"}
              </button>

              {analysis ? (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving || isAnalyzing}
                  className="button button-secondary"
                >
                  {isSaving ? "Saving..." : "Save Feedback"}
                </button>
              ) : null}
            </div>

            {errorMessage ? (
              <p className="error-message">{errorMessage}</p>
            ) : null}
          </div>
        </section>

        <section className="card card-padded">
          <h3 className="card-title">AI Suggested Analysis</h3>
          <p className="card-description">
            This panel shows the AI draft. Staff should review and correct it
            before saving.
          </p>

          {!analysis && !isAnalyzing ? (
            <div className="analysis-placeholder">
              Paste feedback and click Analyze Feedback.
            </div>
          ) : null}

          {isAnalyzing ? (
            <div className="analysis-placeholder">
              Analyzing feedback with AI...
            </div>
          ) : null}

          {analysis ? (
            <div className="analysis-stack">
              <div className="analysis-summary-box">
                <p className="analysis-label">Summary</p>
                <p className="analysis-text">{analysis.summary}</p>
              </div>

              <div className="analysis-grid">
                <div className="analysis-mini-card">
                  <p className="analysis-label">Sentiment</p>
                  <p className="analysis-mini-value">{analysis.sentiment}</p>
                </div>

                <div className="analysis-mini-card">
                  <p className="analysis-label">Severity</p>
                  <p className="analysis-mini-value">{analysis.severity}</p>
                </div>

                <div className="analysis-mini-card">
                  <p className="analysis-label">Issue Type</p>
                  <p className="analysis-mini-value">
                    {analysis.issueTypes.join(", ")}
                  </p>
                </div>

                <div className="analysis-mini-card">
                  <p className="analysis-label">Suggested Status</p>
                  <p className="analysis-mini-value">
                    {analysis.suggestedStatus}
                  </p>
                </div>

                <div className="analysis-mini-card">
                  <p className="analysis-label">Validity Estimate</p>
                  <p className="analysis-mini-value">
                    {analysis.validityEstimate}
                  </p>
                </div>

                <div className="analysis-mini-card">
                  <p className="analysis-label">Confidence</p>
                  <p className="analysis-mini-value">
                    {Math.round(analysis.confidence * 100)}%
                  </p>
                </div>
              </div>

              <div className="analysis-summary-box">
                <p className="analysis-label">Suggested Next Action</p>
                <p className="analysis-text">{analysis.suggestedNextAction}</p>
              </div>

              <div className="analysis-summary-box">
                <p className="analysis-label">Suggested Response</p>
                <p className="analysis-text">
                  {analysis.suggestedResponse || "No response suggested."}
                </p>
              </div>

              <div className="analysis-summary-box">
                <p className="analysis-label">Missing Information</p>
                <p className="analysis-text">
                  {analysis.missingInformation.length > 0
                    ? analysis.missingInformation.join(", ")
                    : "No obvious missing information."}
                </p>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}