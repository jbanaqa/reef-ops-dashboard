"use client";

import { useEffect, useMemo, useState } from "react";

type MonitoringResult = {
  id: string;
  query: string;
  title: string;
  url: string;
  description: string | null;
  age: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  domain: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

const defaultQueries = [
  `"Corals Anonymous"`,
  `"Corals Anonymous" review`,
  `"Corals Anonymous" reef2reef`,
  `"Corals Anonymous" reddit`,
  `"Corals Anonymous" DOA`,
  `"Macroalgae Farms"`,
  `"Macroalgae Farms" review`,
  `site:reef2reef.com "Corals Anonymous"`,
  `site:reddit.com "Corals Anonymous"`,
];

const defaultExcludedDomains = [
  "coralsanonymous.com",
  "macroalgaefarms.com",
  "corals-anonymous.myshopify.com",
  "macroalgaefarms.myshopify.com",
  "instagram.com",
  "facebook.com",
  "youtube.com",
  "tiktok.com",
];

export default function MonitoringPage() {
  const [queryText, setQueryText] = useState(defaultQueries.join("\n"));
  const [excludedDomainText, setExcludedDomainText] = useState(
    defaultExcludedDomains.join("\n")
  );

  const [results, setResults] = useState<MonitoringResult[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);

  const [isScanning, setIsScanning] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [lastScanSummary, setLastScanSummary] = useState("");

  const selectedCount = selectedIds.length;

  const allVisibleSelected = useMemo(() => {
    return results.length > 0 && results.every((result) => selectedIds.includes(result.id));
  }, [results, selectedIds]);

  useEffect(() => {
    loadPendingResults();
  }, []);

  async function loadPendingResults() {
    setErrorMessage("");

    try {
      const response = await fetch("/api/monitoring/results");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to load scan results.");
      }

      setResults(data.results || []);
      setSelectedIds([]);
      setExpandedIds([]);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Something went wrong.";
      setErrorMessage(message);
    }
  }

  async function handleRunScan() {
    const queries = queryText
      .split("\n")
      .map((query) => query.trim())
      .filter(Boolean);

    const excludedDomains = excludedDomainText
      .split("\n")
      .map((domain) => domain.trim())
      .filter(Boolean);

    if (queries.length === 0) {
      alert("Please enter at least one search query.");
      return;
    }

    setIsScanning(true);
    setErrorMessage("");
    setLastScanSummary("");
    setSelectedIds([]);
    setExpandedIds([]);

    try {
      const response = await fetch("/api/monitoring/brave", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ queries, excludedDomains }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to run monitoring scan.");
      }

      setResults(data.results || []);
      setLastScanSummary(
        `Scanned ${data.scannedQueries.length} queries, found ${data.totalResultCount} unique results, filtered out ${data.filteredOutCount}, skipped ${data.alreadySeenCount} already-seen results, and stored ${data.newStoredCount} new results.`
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Something went wrong.";
      setErrorMessage(message);
    } finally {
      setIsScanning(false);
    }
  }

  async function handleBulkAction(action: "save" | "ignore") {
    if (selectedIds.length === 0) {
      alert("Please select at least one result.");
      return;
    }

    const actionLabel = action === "save" ? "save" : "ignore";

    setIsUpdating(true);
    setErrorMessage("");

    try {
      const response = await fetch("/api/monitoring/results", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ids: selectedIds,
          action,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Failed to ${actionLabel} results.`);
      }

      setResults(data.results || []);
      setSelectedIds([]);
      setExpandedIds([]);
      setLastScanSummary(
        `${data.updatedCount} result${data.updatedCount === 1 ? "" : "s"} marked as ${data.status}.`
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Something went wrong.";
      setErrorMessage(message);
    } finally {
      setIsUpdating(false);
    }
  }

  function toggleSelection(id: string) {
    setSelectedIds((currentIds) => {
      if (currentIds.includes(id)) {
        return currentIds.filter((currentId) => currentId !== id);
      }

      return [...currentIds, id];
    });
  }

  function toggleExpanded(id: string) {
    setExpandedIds((currentIds) => {
      if (currentIds.includes(id)) {
        return currentIds.filter((currentId) => currentId !== id);
      }

      return [...currentIds, id];
    });
  }

  function selectAllVisible() {
    setSelectedIds(results.map((result) => result.id));
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  return (
    <div className="page-stack">
      <section>
        <p className="page-header-eyebrow">Monitoring</p>
        <h2 className="page-title">Brand Monitoring</h2>
        <p className="page-description">
          Run manual scans for public company mentions across the web. New URLs
          are stored as scan results so staff can save useful items or ignore
          noise without seeing the same results every time.
        </p>
      </section>

      <div className="two-column-grid">
        <section className="card card-padded">
          <h3 className="card-title">Search Queries</h3>
          <p className="card-description">
            Each line is one query. Use quotes for exact company names and
            site-specific searches for forums or communities.
          </p>

          <div className="form-stack">
            <div>
              <label className="form-label">Queries</label>
              <textarea
                value={queryText}
                onChange={(event) => setQueryText(event.target.value)}
                rows={10}
                className="form-textarea"
              />
            </div>

            <div>
              <label className="form-label">Excluded Domains</label>
              <textarea
                value={excludedDomainText}
                onChange={(event) => setExcludedDomainText(event.target.value)}
                rows={8}
                className="form-textarea"
              />
              <p className="field-help-text">
                Results from these domains will be filtered out. Use this for
                your own websites, Shopify domains, and official social media
                pages.
              </p>
            </div>

            <button
              type="button"
              onClick={handleRunScan}
              disabled={isScanning || isUpdating}
              className="button button-primary"
            >
              {isScanning ? "Scanning..." : "Run Brave Scan"}
            </button>

            {errorMessage ? (
              <p className="error-message">{errorMessage}</p>
            ) : null}

            {lastScanSummary ? (
              <p className="success-message">{lastScanSummary}</p>
            ) : null}
          </div>
        </section>

        <section className="card card-padded">
          <h3 className="card-title">How This Works</h3>
          <p className="card-description">
            This scan calls Brave Search from a backend route, deduplicates by
            URL, filters out owned domains, stores new URLs, and hides already
            reviewed results from future scans.
          </p>

          <div className="analysis-stack">
            <div className="analysis-summary-box">
              <p className="analysis-label">Current Mode</p>
              <p className="analysis-text">
                Manual scan. Staff chooses when to run it.
              </p>
            </div>

            <div className="analysis-summary-box">
              <p className="analysis-label">Result Lifecycle</p>
              <p className="analysis-text">
                New results can be saved for later AI analysis or ignored so
                they do not keep appearing.
              </p>
            </div>

            <div className="analysis-summary-box">
              <p className="analysis-label">Next Upgrade</p>
              <p className="analysis-text">
                Convert saved scan results into Feedback Inbox items with AI
                sentiment, severity, summary, and suggested action.
              </p>
            </div>
          </div>
        </section>
      </div>

      <section className="card feedback-table-card">
        <div className="feedback-table-header">
          <div>
            <h3 className="card-title">Pending Scan Results</h3>
            <p className="card-description">
              Review new results, expand details, then save useful items or
              ignore noise.
            </p>
          </div>

          <p className="feedback-count">
            {results.length} result{results.length === 1 ? "" : "s"}
          </p>
        </div>

        <div className="scan-action-bar">
          <p className="scan-selection-count">
            {selectedCount} selected
          </p>

          <div className="scan-action-buttons">
            <button
              type="button"
              onClick={selectAllVisible}
              disabled={results.length === 0 || allVisibleSelected || isUpdating}
              className="button button-secondary"
            >
              Select All
            </button>

            <button
              type="button"
              onClick={clearSelection}
              disabled={selectedCount === 0 || isUpdating}
              className="button button-secondary"
            >
              Clear Selection
            </button>

            <button
              type="button"
              onClick={() => handleBulkAction("save")}
              disabled={selectedCount === 0 || isUpdating}
              className="button button-primary"
            >
              Save Selected
            </button>

            <button
              type="button"
              onClick={() => handleBulkAction("ignore")}
              disabled={selectedCount === 0 || isUpdating}
              className="button button-secondary"
            >
              Ignore Selected
            </button>
          </div>
        </div>

        {results.length === 0 ? (
          <div className="empty-state">
            <h3 className="empty-state-title">No pending scan results</h3>
            <p className="empty-state-text">
              Run a scan to discover new third-party public mentions.
            </p>
          </div>
        ) : (
          <div className="monitoring-results-list">
            {results.map((result, index) => {
              const resultKey = result.id || result.url || `scan-result-${index}`;
              const isSelected = selectedIds.includes(resultKey);
              const isExpanded = expandedIds.includes(resultKey);

              return (
                <article
                  key={resultKey}
                  className={`monitoring-result-card ${
                    isSelected ? "monitoring-result-selected" : ""
                  }`}
                >
                  <div className="monitoring-result-main">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelection(resultKey)}
                      className="scan-checkbox"
                    />

                    <div className="monitoring-result-content">
                      <p className="monitoring-query">
                        Found by: {result.query}
                      </p>

                      <h3 className="monitoring-result-title">
                        <a href={result.url} target="_blank" rel="noreferrer">
                          {result.title}
                        </a>
                      </h3>

                      <p className="monitoring-result-description">
                        {result.description || "No description available."}
                      </p>

                      <p className="monitoring-result-meta">
                        {result.domain || result.sourceName || "Unknown source"}
                        {result.age ? ` · ${result.age}` : ""}
                      </p>

                      <button
                        type="button"
                        onClick={() => toggleExpanded(resultKey)}
                        className="text-button"
                      >
                        {isExpanded ? "Hide details" : "Show details"}
                      </button>

                      {isExpanded ? (
                        <div className="scan-details">
                          <div>
                            <p className="analysis-label">Full URL</p>
                            <p className="analysis-text break-text">
                              {result.url}
                            </p>
                          </div>

                          <div>
                            <p className="analysis-label">Full Description</p>
                            <p className="analysis-text">
                              {result.description ||
                                "No description available."}
                            </p>
                          </div>

                          <div className="scan-details-grid">
                            <div>
                              <p className="analysis-label">Domain</p>
                              <p className="analysis-text">
                                {result.domain || "Unknown"}
                              </p>
                            </div>

                            <div>
                              <p className="analysis-label">Source Name</p>
                              <p className="analysis-text">
                                {result.sourceName || "Unknown"}
                              </p>
                            </div>

                            <div>
                              <p className="analysis-label">Age</p>
                              <p className="analysis-text">
                                {result.age || "Unknown"}
                              </p>
                            </div>

                            <div>
                              <p className="analysis-label">Status</p>
                              <p className="analysis-text">{result.status}</p>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}