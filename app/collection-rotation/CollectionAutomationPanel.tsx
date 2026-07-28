"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  STRATEGY_LABELS,
  type RotationStrategy,
} from "@/lib/collection-rotation-scoring";

// Custom weights are tuned per collection in the Strategy panel below, so
// bulk strategy assignment only offers the four presets that come with a
// ready-made weight split.
const BULK_STRATEGY_OPTIONS: Exclude<RotationStrategy, "CUSTOM">[] = [
  "BALANCED",
  "PERFORMANCE",
  "DISCOVERY",
  "RANDOM",
];

type CollectionSummary = {
  id: string;
  title: string;
  handle: string;
  productsCount: number;
  isStarred: boolean;
  isEnabled: boolean;
  strategy: string;
  controlledTopCount: number;
  controlledAssignedCount: number;
};

function strategyLabel(strategy: string) {
  return (
    STRATEGY_LABELS[strategy as RotationStrategy] ?? "Balanced"
  );
}

type AutomationStatus = {
  serverNow: string;
  scheduleEnabled: boolean;
  intervalMinutes: number;
  intervalLabel: string;
  enabledCollectionCount: number;
  nextScheduledRunAt: string;
  lastRun: {
    id: string;
    scheduledFor: string;
    status: string;
    enabledCount: number;
    completedCount: number;
    failedCount: number;
    startedAt: string;
    completedAt: string | null;
  } | null;
};

async function readResponse<T>(
  response: Response
): Promise<T> {
  const data: unknown =
    await response.json();

  if (
    typeof data !== "object" ||
    data === null
  ) {
    throw new Error(
      "The server returned an invalid response."
    );
  }

  const responseData = data as {
    ok?: unknown;
    error?: unknown;
  };

  if (
    !response.ok ||
    responseData.ok === false
  ) {
    const message =
      typeof responseData.error ===
      "string"
        ? responseData.error
        : "The request failed.";

    throw new Error(message);
  }

  return data as T;
}

function formatCountdown(
  milliseconds: number
) {
  const safeMilliseconds =
    Math.max(milliseconds, 0);

  const totalSeconds =
    Math.floor(
      safeMilliseconds / 1000
    );

  const hours =
    Math.floor(
      totalSeconds / 3600
    );

  const minutes =
    Math.floor(
      (totalSeconds % 3600) /
        60
    );

  const seconds =
    totalSeconds % 60;

  return [
    hours,
    minutes,
    seconds,
  ]
    .map((value) =>
      String(value).padStart(2, "0")
    )
    .join(":");
}

function formatDateTime(
  value: string
) {
  return new Intl.DateTimeFormat(
    "en-US",
    {
      dateStyle: "medium",
      timeStyle: "short",
    }
  ).format(new Date(value));
}

export default function CollectionAutomationPanel({
  onCollectionsChanged,
}: {
  onCollectionsChanged?: () => void;
}) {
  const [
    status,
    setStatus,
  ] = useState<AutomationStatus | null>(
    null
  );

  const [
    collections,
    setCollections,
  ] = useState<
    CollectionSummary[]
  >([]);

  const [
    remainingMilliseconds,
    setRemainingMilliseconds,
  ] = useState(0);

  const [
    isManaging,
    setIsManaging,
  ] = useState(false);

  const [
    isLoading,
    setIsLoading,
  ] = useState(true);

  const [
    activeCollectionId,
    setActiveCollectionId,
  ] = useState<string | null>(
    null
  );

  const [
    searchTerm,
    setSearchTerm,
  ] = useState("");

  const [
    errorMessage,
    setErrorMessage,
  ] = useState("");

  const [
    successMessage,
    setSuccessMessage,
  ] = useState("");

  const [
    selectedIds,
    setSelectedIds,
  ] = useState<Set<string>>(
    new Set()
  );

  const [
    bulkStrategy,
    setBulkStrategy,
  ] = useState<RotationStrategy>(
    "BALANCED"
  );

  const [
    isBulkApplying,
    setIsBulkApplying,
  ] = useState(false);

  const loadAutomationData =
    useCallback(async () => {
      setErrorMessage("");
      setSuccessMessage("");

      try {
        const [
          statusResponse,
          collectionsResponse,
        ] = await Promise.all([
          fetch(
            "/api/collection-rotation/automation",
            {
              cache: "no-store",
            }
          ),

          fetch(
            "/api/collection-rotation/collections",
            {
              cache: "no-store",
            }
          ),
        ]);

        const statusData =
          await readResponse<{
            ok: true;
          } & AutomationStatus>(
            statusResponse
          );

        const collectionsData =
          await readResponse<{
            ok: true;
            collections:
              CollectionSummary[];
          }>(
            collectionsResponse
          );

        setStatus(statusData);

        setCollections(
          collectionsData.collections
        );

        setRemainingMilliseconds(
          new Date(
            statusData.nextScheduledRunAt
          ).getTime() -
            Date.now()
        );
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Failed to load scheduling status."
        );
      } finally {
        setIsLoading(false);
      }
    }, []);

  useEffect(() => {
    void loadAutomationData();
  }, [loadAutomationData]);

  useEffect(() => {
    if (!status) {
      return;
    }

    const timer =
      window.setInterval(() => {
        const remaining =
          new Date(
            status.nextScheduledRunAt
          ).getTime() -
          Date.now();

        if (remaining <= 0) {
          void loadAutomationData();
          return;
        }

        setRemainingMilliseconds(
          remaining
        );
      }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [
    status,
    loadAutomationData,
  ]);

  const visibleCollections =
    useMemo(() => {
      const normalizedSearch =
        searchTerm
          .trim()
          .toLowerCase();

      return collections
        .filter((collection) => {
          if (!normalizedSearch) {
            return true;
          }

          return (
            collection.title
              .toLowerCase()
              .includes(
                normalizedSearch
              ) ||
            collection.handle
              .toLowerCase()
              .includes(
                normalizedSearch
              )
          );
        })
        .sort((first, second) => {
          if (
            first.isEnabled !==
            second.isEnabled
          ) {
            return first.isEnabled
              ? -1
              : 1;
          }

          if (
            first.isStarred !==
            second.isStarred
          ) {
            return first.isStarred
              ? -1
              : 1;
          }

          return (
            second.productsCount -
              first.productsCount ||
            first.title.localeCompare(
              second.title
            )
          );
        });
    }, [
      collections,
      searchTerm,
    ]);

  async function toggleAutomation(
    collection: CollectionSummary
  ) {
    if (activeCollectionId) {
      return;
    }

    const nextEnabled =
      !collection.isEnabled;

    setActiveCollectionId(
      collection.id
    );

    setErrorMessage("");

    setCollections(
      (currentCollections) =>
        currentCollections.map(
          (item) =>
            item.id ===
            collection.id
              ? {
                  ...item,
                  isEnabled:
                    nextEnabled,
                }
              : item
        )
    );

    try {
      const response = await fetch(
        "/api/collection-rotation/automation",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            collectionId:
              collection.id,

            collectionTitle:
              collection.title,

            collectionHandle:
              collection.handle,

            isEnabled:
              nextEnabled,
          }),
        }
      );

      const data =
        await readResponse<{
          ok: true;
          enabledCollectionCount: number;
        }>(response);

      setStatus((currentStatus) =>
        currentStatus
          ? {
              ...currentStatus,

              enabledCollectionCount:
                data.enabledCollectionCount,
            }
          : currentStatus
      );

      onCollectionsChanged?.();
    } catch (error) {
      setCollections(
        (currentCollections) =>
          currentCollections.map(
            (item) =>
              item.id ===
              collection.id
                ? {
                    ...item,
                    isEnabled:
                      collection.isEnabled,
                  }
                : item
          )
      );

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to update automatic shuffling."
      );
    } finally {
      setActiveCollectionId(
        null
      );
    }
  }

  function toggleSelection(
    collectionId: string
  ) {
    setSelectedIds(
      (current) => {
        const next = new Set(
          current
        );

        if (next.has(collectionId)) {
          next.delete(collectionId);
        } else {
          next.add(collectionId);
        }

        return next;
      }
    );
  }

  const allVisibleSelected =
    visibleCollections.length > 0 &&
    visibleCollections.every(
      (collection) =>
        selectedIds.has(collection.id)
    );

  function toggleSelectAllVisible() {
    setSelectedIds((current) => {
      if (allVisibleSelected) {
        const next = new Set(current);
        visibleCollections.forEach(
          (collection) =>
            next.delete(collection.id)
        );
        return next;
      }

      const next = new Set(current);
      visibleCollections.forEach(
        (collection) =>
          next.add(collection.id)
      );
      return next;
    });
  }

  async function applyBulkStrategy() {
    if (
      selectedIds.size === 0 ||
      isBulkApplying
    ) {
      return;
    }

    setIsBulkApplying(true);
    setErrorMessage("");
    setSuccessMessage("");

    const targetCollections =
      collections.filter((collection) =>
        selectedIds.has(collection.id)
      );

    try {
      const response = await fetch(
        "/api/collection-rotation/strategy/bulk",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            strategy: bulkStrategy,

            collections:
              targetCollections.map(
                (collection) => ({
                  collectionId:
                    collection.id,
                  collectionTitle:
                    collection.title,
                  collectionHandle:
                    collection.handle,
                })
              ),
          }),
        }
      );

      const data = await readResponse<{
        ok: true;
        updatedCount: number;
        failed: Array<{
          collectionId: string;
          error?: string;
        }>;
      }>(response);

      const failedIds = new Set(
        data.failed.map(
          (failure) =>
            failure.collectionId
        )
      );

      setCollections(
        (currentCollections) =>
          currentCollections.map(
            (item) =>
              selectedIds.has(
                item.id
              ) &&
              !failedIds.has(item.id)
                ? {
                    ...item,
                    strategy:
                      bulkStrategy,
                  }
                : item
          )
      );

      setSuccessMessage(
        data.failed.length > 0
          ? `Applied ${strategyLabel(bulkStrategy)} to ${data.updatedCount} collection(s). ${data.failed.length} failed.`
          : `Applied ${strategyLabel(bulkStrategy)} to ${data.updatedCount} collection(s).`
      );

      setSelectedIds(new Set());
      onCollectionsChanged?.();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to apply the strategy to the selected collections."
      );
    } finally {
      setIsBulkApplying(false);
    }
  }

  return (
    <section className="rotation-automation-card">
      <div className="rotation-automation-top">
        <div>
          <p className="page-header-eyebrow">
            Automatic collection rotation
          </p>

          <h2 className="rotation-automation-heading">
            Next automatic shuffle
          </h2>
        </div>

        <span
          className={`rotation-automation-state ${
            status?.scheduleEnabled
              ? "rotation-automation-state-active"
              : "rotation-automation-state-inactive"
          }`}
        >
          {status?.scheduleEnabled
            ? "Scheduling active"
            : "Scheduling not active"}
        </span>
      </div>

      {errorMessage ? (
        <p className="rotation-alert rotation-alert-error">
          {errorMessage}
        </p>
      ) : null}

      <div className="rotation-countdown">
        {isLoading
          ? "--:--:--"
          : formatCountdown(
              remainingMilliseconds
            )}
      </div>

      {status ? (
        <>
          <p className="rotation-countdown-date">
            Scheduled for{" "}
            <strong>
              {formatDateTime(
                status.nextScheduledRunAt
              )}
            </strong>
          </p>

          <div className="rotation-automation-metrics">
            <div>
              <span>Schedule</span>
              <strong>
                {status.intervalLabel}
              </strong>
            </div>

            <div>
              <span>
                Enabled collections
              </span>
              <strong>
                {
                  status.enabledCollectionCount
                }
              </strong>
            </div>

            <div>
              <span>
                Last scheduled cycle
              </span>

              <strong>
                {status.lastRun
                  ? status.lastRun.status
                  : "No runs yet"}
              </strong>
            </div>
          </div>

          {status.lastRun ? (
            <p className="rotation-last-run-copy">
              Last scheduled start:{" "}
              {formatDateTime(
                status.lastRun
                  .scheduledFor
              )}
              .{" "}
              {
                status.lastRun
                  .completedCount
              }{" "}
              completed and{" "}
              {
                status.lastRun
                  .failedCount
              }{" "}
              failed.
            </p>
          ) : null}
        </>
      ) : null}

      <div className="rotation-automation-actions">
        <button
          type="button"
          className="button button-secondary"
          onClick={() =>
            setIsManaging(
              (current) => !current
            )
          }
        >
          {isManaging
            ? "Close Automatic Set"
            : "Manage Automatic Set"}
        </button>

        <button
          type="button"
          className="rotation-text-button"
          onClick={() =>
            void loadAutomationData()
          }
          disabled={isLoading}
        >
          Refresh schedule
        </button>
      </div>

      {isManaging ? (
        <div className="rotation-automation-manager">
          <div className="rotation-automation-manager-header">
            <div>
              <h3>
                Automatic collections
              </h3>

              <p>
                Enabled collections will be
                shuffled by Railway at every
                scheduled boundary.
              </p>
            </div>

            <input
              type="search"
              className="form-input rotation-automation-search"
              value={searchTerm}
              onChange={(event) =>
                setSearchTerm(
                  event.target.value
                )
              }
              placeholder="Search collections"
            />
          </div>

          <div className="rotation-automation-bulk-bar">
            <label className="rotation-automation-select-all">
              <input
                type="checkbox"
                checked={
                  allVisibleSelected
                }
                onChange={
                  toggleSelectAllVisible
                }
              />
              <span>
                {selectedIds.size > 0
                  ? `${selectedIds.size} selected`
                  : "Select all visible"}
              </span>
            </label>

            {selectedIds.size > 0 ? (
              <div className="rotation-automation-bulk-actions">
                <select
                  className="form-select"
                  value={bulkStrategy}
                  onChange={(event) =>
                    setBulkStrategy(
                      event.target
                        .value as RotationStrategy
                    )
                  }
                  disabled={
                    isBulkApplying
                  }
                >
                  {BULK_STRATEGY_OPTIONS.map(
                    (strategy) => (
                      <option
                        key={strategy}
                        value={strategy}
                      >
                        {
                          STRATEGY_LABELS[
                            strategy
                          ]
                        }
                      </option>
                    )
                  )}
                </select>

                <button
                  type="button"
                  className="button button-secondary"
                  disabled={
                    isBulkApplying
                  }
                  onClick={() =>
                    void applyBulkStrategy()
                  }
                >
                  {isBulkApplying
                    ? "Applying..."
                    : `Apply to ${selectedIds.size}`}
                </button>

                <button
                  type="button"
                  className="rotation-text-button"
                  disabled={
                    isBulkApplying
                  }
                  onClick={() =>
                    setSelectedIds(
                      new Set()
                    )
                  }
                >
                  Clear
                </button>
              </div>
            ) : (
              <p className="rotation-automation-bulk-hint">
                Select collections to set a
                strategy for several at once.
                Custom weights are still tuned
                one collection at a time below.
              </p>
            )}
          </div>

          {successMessage ? (
            <p className="rotation-alert rotation-alert-success rotation-automation-bulk-message">
              {successMessage}
            </p>
          ) : null}

          <div className="rotation-automation-list">
            {visibleCollections.map(
              (collection) => (
                <div
                  key={collection.id}
                  className="rotation-automation-row"
                >
                  <div className="rotation-automation-row-main">
                    <label className="rotation-automation-row-select">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(
                          collection.id
                        )}
                        onChange={() =>
                          toggleSelection(
                            collection.id
                          )
                        }
                      />
                    </label>

                    <div>
                      <p className="rotation-automation-row-title">
                        {collection.isStarred
                          ? "★ "
                          : ""}
                        {collection.title}
                      </p>

                      <p className="rotation-automation-row-meta">
                        {
                          collection.productsCount
                        }{" "}
                        products ·{" "}
                        {strategyLabel(
                          collection.strategy
                        )}{" "}
                        strategy
                        {collection.controlledTopCount >
                        0
                          ? ` · Top ${collection.controlledTopCount} controlled · ${collection.controlledAssignedCount} assigned`
                          : ""}
                      </p>
                    </div>
                  </div>

                  <label className="rotation-toggle">
                    <input
                      type="checkbox"
                      checked={
                        collection.isEnabled
                      }
                      onChange={() =>
                        void toggleAutomation(
                          collection
                        )
                      }
                      disabled={
                        activeCollectionId ===
                        collection.id
                      }
                    />

                    <span className="rotation-toggle-track">
                      <span className="rotation-toggle-thumb" />
                    </span>

                    <span className="rotation-toggle-label">
                      {collection.isEnabled
                        ? "Enabled"
                        : "Disabled"}
                    </span>
                  </label>
                </div>
              )
            )}
          </div>
        </div>
      ) : null}

      <p className="rotation-automation-note">
        Manual shuffles remain available
        below and do not reset or delay
        this countdown.
      </p>
    </section>
  );
}