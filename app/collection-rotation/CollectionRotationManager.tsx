"use client";
import CollectionAutomationPanel from "./CollectionAutomationPanel";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type CollectionSummary = {
  id: string;
  legacyResourceId: string;
  title: string;
  handle: string;
  sortOrder: string;
  productsCount: number;
  isStarred: boolean;
  isEnabled: boolean;
  controlledTopCount: number;
  controlledAssignedCount: number;
  lastShuffledAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  canUndo: boolean;
};

type BatchResult = {
  collectionId: string;
  collectionTitle: string;
  status:
    | "Waiting"
    | "Shuffling"
    | "Completed"
    | "Failed";
  message: string | null;
};

type ControlProduct = {
  id: string;
  title: string;
  handle: string;
  imageUrl: string | null;
};

type ControlAssignment = {
  position: number;
  productId: string;
};

type ControlEditor = {
  collectionId: string;
  collectionTitle: string;
  productCount: number;
  controlledTopCount: number;
  assignments: ControlAssignment[];
  products: ControlProduct[];
};

type SortMode =
  | "count-desc"
  | "count-asc"
  | "alphabetical"
  | "recent";

type FilterMode =
  | "all"
  | "starred";


function formatDate(
  value: string | null
) {
  if (!value) {
    return "Never";
  }

  return new Intl.DateTimeFormat(
    "en-US",
    {
      dateStyle: "medium",
      timeStyle: "short",
    }
  ).format(new Date(value));
}

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

export default function CollectionRotationManager() {
  const [
    collections,
    setCollections,
  ] = useState<
    CollectionSummary[]
  >([]);

  const [
    selectedCollectionIds,
    setSelectedCollectionIds,
  ] = useState<string[]>([]);

  const [
    searchTerm,
    setSearchTerm,
  ] = useState("");

  const [
    filterMode,
    setFilterMode,
  ] = useState<FilterMode>("all");

  const [
    sortMode,
    setSortMode,
  ] = useState<SortMode>(
    "count-desc"
  );

  const [
    batchResults,
    setBatchResults,
  ] = useState<BatchResult[]>([]);

  const [
    controlEditor,
    setControlEditor,
  ] = useState<ControlEditor | null>(
    null
  );

  const [
    selectedControlPosition,
    setSelectedControlPosition,
  ] = useState<number | null>(
    null
  );

  const [
    productSearch,
    setProductSearch,
  ] = useState("");

  const [
    isLoadingCollections,
    setIsLoadingCollections,
  ] = useState(true);

  const [
    isShufflingBatch,
    setIsShufflingBatch,
  ] = useState(false);

  const [
    isLoadingControlEditor,
    setIsLoadingControlEditor,
  ] = useState(false);

  const [
    isSavingControlEditor,
    setIsSavingControlEditor,
  ] = useState(false);

  const [
    activeStarId,
    setActiveStarId,
  ] = useState<string | null>(
    null
  );

  const [
    activeUndoId,
    setActiveUndoId,
  ] = useState<string | null>(
    null
  );

  const [
    batchProgress,
    setBatchProgress,
  ] = useState("");

  const [
    errorMessage,
    setErrorMessage,
  ] = useState("");

  const [
    successMessage,
    setSuccessMessage,
  ] = useState("");

  const loadCollections =
    useCallback(async () => {
      setIsLoadingCollections(true);
      setErrorMessage("");

      try {
        const response = await fetch(
          "/api/collection-rotation/collections",
          {
            method: "GET",
            cache: "no-store",
          }
        );

        const data =
          await readResponse<{
            ok: true;
            collections:
              CollectionSummary[];
          }>(response);

        setCollections(
          data.collections
        );

        setSelectedCollectionIds(
          (currentIds) =>
            currentIds.filter(
              (collectionId) =>
                data.collections.some(
                  (collection) =>
                    collection.id ===
                    collectionId
                )
            )
        );
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Failed to load collections."
        );
      } finally {
        setIsLoadingCollections(
          false
        );
      }
    }, []);

  useEffect(() => {
    void loadCollections();
  }, [loadCollections]);

  const visibleCollections =
    useMemo(() => {
      const normalizedSearch =
        searchTerm
          .trim()
          .toLowerCase();

      const filtered =
        collections.filter(
          (collection) => {
            if (
              filterMode ===
                "starred" &&
              !collection.isStarred
            ) {
              return false;
            }

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
          }
        );

      return [...filtered].sort(
        (first, second) => {
          if (
            first.isStarred !==
            second.isStarred
          ) {
            return first.isStarred
              ? -1
              : 1;
          }

          if (
            sortMode ===
            "count-desc"
          ) {
            return (
              second.productsCount -
                first.productsCount ||
              first.title.localeCompare(
                second.title
              )
            );
          }

          if (
            sortMode ===
            "count-asc"
          ) {
            return (
              first.productsCount -
                second.productsCount ||
              first.title.localeCompare(
                second.title
              )
            );
          }

          if (
            sortMode === "recent"
          ) {
            const firstTime =
              first.lastShuffledAt
                ? new Date(
                    first.lastShuffledAt
                  ).getTime()
                : 0;

            const secondTime =
              second.lastShuffledAt
                ? new Date(
                    second.lastShuffledAt
                  ).getTime()
                : 0;

            return (
              secondTime -
                firstTime ||
              first.title.localeCompare(
                second.title
              )
            );
          }

          return first.title.localeCompare(
            second.title
          );
        }
      );
    }, [
      collections,
      filterMode,
      searchTerm,
      sortMode,
    ]);

  const selectedIdSet =
    useMemo(
      () =>
        new Set(
          selectedCollectionIds
        ),
      [selectedCollectionIds]
    );

  const selectedCollections =
    useMemo(
      () =>
        collections.filter(
          (collection) =>
            selectedIdSet.has(
              collection.id
            )
        ),
      [
        collections,
        selectedIdSet,
      ]
    );

  const allVisibleEligibleSelected =
    useMemo(() => {
      const eligible =
        visibleCollections.filter(
          (collection) =>
            collection.productsCount >=
            2
        );

      return (
        eligible.length > 0 &&
        eligible.every(
          (collection) =>
            selectedIdSet.has(
              collection.id
            )
        )
      );
    }, [
      visibleCollections,
      selectedIdSet,
    ]);

  const filteredControlProducts =
    useMemo(() => {
      if (!controlEditor) {
        return [];
      }

      const normalizedSearch =
        productSearch
          .trim()
          .toLowerCase();

      const assignedIds =
        new Set(
          controlEditor.assignments
            .filter(
              (assignment) =>
                assignment.position !==
                selectedControlPosition
            )
            .map(
              (assignment) =>
                assignment.productId
            )
        );

      return controlEditor.products
        .filter(
          (product) =>
            !assignedIds.has(
              product.id
            )
        )
        .filter((product) => {
          if (!normalizedSearch) {
            return true;
          }

          return (
            product.title
              .toLowerCase()
              .includes(
                normalizedSearch
              ) ||
            product.handle
              .toLowerCase()
              .includes(
                normalizedSearch
              )
          );
        });
    }, [
      controlEditor,
      productSearch,
      selectedControlPosition,
    ]);

  const completedCount =
    batchResults.filter(
      (result) =>
        result.status ===
        "Completed"
    ).length;

  const failedCount =
    batchResults.filter(
      (result) =>
        result.status === "Failed"
    ).length;

  const isBusy =
    isLoadingCollections ||
    isShufflingBatch ||
    isLoadingControlEditor ||
    isSavingControlEditor;

  function clearMessages() {
    setErrorMessage("");
    setSuccessMessage("");
  }

  function clearResults() {
    setBatchResults([]);
    setBatchProgress("");
  }

  function toggleCollectionSelection(
    collectionId: string
  ) {
    setSelectedCollectionIds(
      (currentIds) =>
        currentIds.includes(
          collectionId
        )
          ? currentIds.filter(
              (id) =>
                id !== collectionId
            )
          : [
              ...currentIds,
              collectionId,
            ]
    );

    clearResults();
    clearMessages();
  }

  function selectAllVisible() {
    const eligibleIds =
      visibleCollections
        .filter(
          (collection) =>
            collection.productsCount >=
            2
        )
        .map(
          (collection) =>
            collection.id
        );

    setSelectedCollectionIds(
      (currentIds) => {
        const nextIds =
          new Set(currentIds);

        for (
          const collectionId of
          eligibleIds
        ) {
          nextIds.add(
            collectionId
          );
        }

        return [...nextIds];
      }
    );

    clearResults();
    clearMessages();
  }

  function deselectAllVisible() {
    const visibleIdSet =
      new Set(
        visibleCollections.map(
          (collection) =>
            collection.id
        )
      );

    setSelectedCollectionIds(
      (currentIds) =>
        currentIds.filter(
          (collectionId) =>
            !visibleIdSet.has(
              collectionId
            )
        )
    );

    clearResults();
    clearMessages();
  }

  function selectAllStarred() {
    const starredIds =
      collections
        .filter(
          (collection) =>
            collection.isStarred &&
            collection.productsCount >=
              2
        )
        .map(
          (collection) =>
            collection.id
        );

    setSelectedCollectionIds(
      starredIds
    );

    clearResults();
    clearMessages();
  }

  function clearSelection() {
    setSelectedCollectionIds([]);
    clearResults();
    clearMessages();
  }

  async function toggleStar(
    collection: CollectionSummary
  ) {
    if (activeStarId) {
      return;
    }

    const nextIsStarred =
      !collection.isStarred;

    setActiveStarId(
      collection.id
    );

    clearMessages();

    setCollections(
      (currentCollections) =>
        currentCollections.map(
          (item) =>
            item.id ===
            collection.id
              ? {
                  ...item,
                  isStarred:
                    nextIsStarred,
                }
              : item
        )
    );

    try {
      await readResponse<{
        ok: true;
        collectionId: string;
        isStarred: boolean;
      }>(
        await fetch(
          "/api/collection-rotation/star",
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
              isStarred:
                nextIsStarred,
            }),
          }
        )
      );
    } catch (error) {
      setCollections(
        (currentCollections) =>
          currentCollections.map(
            (item) =>
              item.id ===
              collection.id
                ? {
                    ...item,
                    isStarred:
                      collection.isStarred,
                  }
                : item
          )
      );

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to update the collection star."
      );
    } finally {
      setActiveStarId(null);
    }
  }

  async function openControlEditor(
    collection: CollectionSummary
  ) {
    setIsLoadingControlEditor(
      true
    );

    clearMessages();

    try {
      const response = await fetch(
        `/api/collection-rotation/control?collectionId=${encodeURIComponent(
          collection.id
        )}`,
        {
          method: "GET",
          cache: "no-store",
        }
      );

      const data =
        await readResponse<{
          ok: true;
          collection: {
            id: string;
            title: string;
            productCount: number;
          };
          controlledTopCount: number;
          assignments:
            ControlAssignment[];
          products:
            ControlProduct[];
        }>(response);

      setControlEditor({
        collectionId:
          data.collection.id,
        collectionTitle:
          data.collection.title,
        productCount:
          data.collection.productCount,
        controlledTopCount:
          data.controlledTopCount,
        assignments:
          data.assignments,
        products:
          data.products,
      });

      setSelectedControlPosition(
        data.controlledTopCount > 0
          ? 1
          : null
      );

      setProductSearch("");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to load controlled positions."
      );
    } finally {
      setIsLoadingControlEditor(
        false
      );
    }
  }

  function updateControlledTopCount(
    nextCount: number
  ) {
    setControlEditor(
      (currentEditor) => {
        if (!currentEditor) {
          return currentEditor;
        }

        const normalizedCount =
          Math.min(
            Math.max(
              Math.floor(
                nextCount || 0
              ),
              0
            ),
            currentEditor.productCount
          );

        return {
          ...currentEditor,
          controlledTopCount:
            normalizedCount,
          assignments:
            currentEditor.assignments.filter(
              (assignment) =>
                assignment.position <=
                normalizedCount
            ),
        };
      }
    );

    setSelectedControlPosition(
      (currentPosition) => {
        if (
          !currentPosition ||
          currentPosition >
            nextCount
        ) {
          return nextCount > 0
            ? 1
            : null;
        }

        return currentPosition;
      }
    );
  }

  function assignProductToPosition(
    productId: string
  ) {
    if (
      !controlEditor ||
      !selectedControlPosition
    ) {
      return;
    }

    setControlEditor(
      (currentEditor) => {
        if (!currentEditor) {
          return currentEditor;
        }

        const withoutCurrentPosition =
          currentEditor.assignments.filter(
            (assignment) =>
              assignment.position !==
              selectedControlPosition
          );

        return {
          ...currentEditor,
          assignments: [
            ...withoutCurrentPosition,
            {
              position:
                selectedControlPosition,
              productId,
            },
          ].sort(
            (first, second) =>
              first.position -
              second.position
          ),
        };
      }
    );
  }

  function removePositionAssignment(
    position: number
  ) {
    setControlEditor(
      (currentEditor) => {
        if (!currentEditor) {
          return currentEditor;
        }

        return {
          ...currentEditor,
          assignments:
            currentEditor.assignments.filter(
              (assignment) =>
                assignment.position !==
                position
            ),
        };
      }
    );
  }

  function moveAssignment(
    position: number,
    direction: -1 | 1
  ) {
    if (!controlEditor) {
      return;
    }

    const targetPosition =
      position + direction;

    if (
      targetPosition < 1 ||
      targetPosition >
        controlEditor.controlledTopCount
    ) {
      return;
    }

    setControlEditor(
      (currentEditor) => {
        if (!currentEditor) {
          return currentEditor;
        }

        const sourceAssignment =
          currentEditor.assignments.find(
            (assignment) =>
              assignment.position ===
              position
          );

        if (!sourceAssignment) {
          return currentEditor;
        }

        const targetAssignment =
          currentEditor.assignments.find(
            (assignment) =>
              assignment.position ===
              targetPosition
          );

        return {
          ...currentEditor,
          assignments:
            currentEditor.assignments.map(
              (assignment) => {
                if (
                  assignment.position ===
                  position
                ) {
                  return {
                    ...assignment,
                    position:
                      targetPosition,
                  };
                }

                if (
                  targetAssignment &&
                  assignment.position ===
                    targetPosition
                ) {
                  return {
                    ...assignment,
                    position,
                  };
                }

                return assignment;
              }
            ),
        };
      }
    );

    setSelectedControlPosition(
      targetPosition
    );
  }

  async function saveControlEditor() {
    if (!controlEditor) {
      return;
    }

    setIsSavingControlEditor(
      true
    );

    clearMessages();

    try {
      const response = await fetch(
        "/api/collection-rotation/control",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            collectionId:
              controlEditor.collectionId,
            controlledTopCount:
              controlEditor.controlledTopCount,
            assignments:
              controlEditor.assignments,
          }),
        }
      );

      const data =
        await readResponse<{
          ok: true;
          controlledTopCount: number;
          controlledAssignedCount: number;
        }>(response);

      setSuccessMessage(
        `${controlEditor.collectionTitle}: top ${data.controlledTopCount} positions saved with ${data.controlledAssignedCount} assigned product${
          data.controlledAssignedCount ===
          1
            ? ""
            : "s"
        }.`
      );

      setControlEditor(null);
      setSelectedControlPosition(
        null
      );

      await loadCollections();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to save controlled positions."
      );
    } finally {
      setIsSavingControlEditor(
        false
      );
    }
  }

  async function shuffleSelected() {
    if (
      selectedCollections.length ===
      0
    ) {
      return;
    }

    const confirmed =
      window.confirm(
        `Shuffle ${selectedCollections.length} selected collection${
          selectedCollections.length ===
          1
            ? ""
            : "s"
        }?\n\nSaved controlled top positions will stay in their assigned places. All remaining products will be randomized.`
      );

    if (!confirmed) {
      return;
    }

    clearMessages();
    clearResults();
    setIsShufflingBatch(true);

    const initialResults =
      selectedCollections.map(
        (
          collection
        ): BatchResult => ({
          collectionId:
            collection.id,
          collectionTitle:
            collection.title,
          status: "Waiting",
          message: null,
        })
      );

    setBatchResults(
      initialResults
    );

    for (
      let index = 0;
      index <
      selectedCollections.length;
      index += 1
    ) {
      const collection =
        selectedCollections[index];

      setBatchProgress(
        `Shuffling ${
          index + 1
        } of ${
          selectedCollections.length
        }: ${collection.title}`
      );

      setBatchResults(
        (currentResults) =>
          currentResults.map(
            (result) =>
              result.collectionId ===
              collection.id
                ? {
                    ...result,
                    status:
                      "Shuffling",
                    message: null,
                  }
                : result
          )
      );

      try {
        const response =
          await fetch(
            "/api/collection-rotation/shuffle",
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json",
              },
              body: JSON.stringify({
                collectionId:
                  collection.id,
                triggerType:
                  "Batch",
              }),
            }
          );

        const data =
          await readResponse<{
            ok: true;
            result: {
              movesCount: number;
              controlledTopCount: number;
              controlledAssignedCount: number;
            };
          }>(response);

        const controlMessage =
          data.result
            .controlledTopCount > 0
            ? ` Top ${data.result.controlledTopCount} controlled; ${data.result.controlledAssignedCount} specifically assigned.`
            : "";

        setBatchResults(
          (currentResults) =>
            currentResults.map(
              (result) =>
                result.collectionId ===
                collection.id
                  ? {
                      ...result,
                      status:
                        "Completed",
                      message: `${data.result.movesCount} product moves applied.${controlMessage}`,
                    }
                  : result
            )
        );
      } catch (error) {
        setBatchResults(
          (currentResults) =>
            currentResults.map(
              (result) =>
                result.collectionId ===
                collection.id
                  ? {
                      ...result,
                      status:
                        "Failed",
                      message:
                        error instanceof
                        Error
                          ? error.message
                          : "The shuffle failed.",
                    }
                  : result
            )
        );
      }
    }

    setBatchProgress("");
    setIsShufflingBatch(false);

    await loadCollections();
  }

  async function undoShuffle(
    collection: CollectionSummary
  ) {
    if (
      !collection.canUndo ||
      activeUndoId
    ) {
      return;
    }

    const confirmed =
      window.confirm(
        `Undo the latest shuffle for "${collection.title}"?`
      );

    if (!confirmed) {
      return;
    }

    setActiveUndoId(
      collection.id
    );

    clearMessages();

    try {
      const response = await fetch(
        "/api/collection-rotation/undo",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            collectionId:
              collection.id,
          }),
        }
      );

      const data =
        await readResponse<{
          ok: true;
          result: {
            movesCount: number;
          };
        }>(response);

      setSuccessMessage(
        `${collection.title} was restored. Shopify applied ${data.result.movesCount} product moves.`
      );

      clearResults();
      await loadCollections();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "The undo operation failed."
      );
    } finally {
      setActiveUndoId(null);
    }
  }

  return (
  <>
    <CollectionAutomationPanel
      onCollectionsChanged={() => {
        void loadCollections();
      }}
    />

    <section className="card card-padded">
        <div className="rotation-section-heading">
          <div>
            <h3 className="card-title">
              Choose collections
            </h3>

            <p className="card-description">
              Shuffle full collections or
              configure exact products to
              remain in controlled top
              positions.
            </p>
          </div>

          <button
            type="button"
            className="button button-secondary"
            onClick={() =>
              void loadCollections()
            }
            disabled={isBusy}
          >
            {isLoadingCollections
              ? "Loading..."
              : "Refresh Collections"}
          </button>
        </div>

        {errorMessage ? (
          <p className="rotation-alert rotation-alert-error">
            {errorMessage}
          </p>
        ) : null}

        {successMessage ? (
          <p className="rotation-alert rotation-alert-success">
            {successMessage}
          </p>
        ) : null}

        {batchProgress ? (
          <p className="rotation-alert rotation-alert-progress">
            {batchProgress}
          </p>
        ) : null}

        <div className="rotation-toolbar">
          <div className="rotation-search-field">
            <label
              className="form-label"
              htmlFor="collection-search"
            >
              Search collections
            </label>

            <input
              id="collection-search"
              type="search"
              className="form-input"
              value={searchTerm}
              onChange={(event) =>
                setSearchTerm(
                  event.target.value
                )
              }
              placeholder="Search by title or handle"
            />
          </div>

          <div>
            <label
              className="form-label"
              htmlFor="collection-filter"
            >
              Show
            </label>

            <select
              id="collection-filter"
              className="form-select"
              value={filterMode}
              onChange={(event) =>
                setFilterMode(
                  event.target
                    .value as FilterMode
                )
              }
            >
              <option value="all">
                All collections
              </option>

              <option value="starred">
                Starred only
              </option>
            </select>
          </div>

          <div>
            <label
              className="form-label"
              htmlFor="collection-sort"
            >
              Sort by
            </label>

            <select
              id="collection-sort"
              className="form-select"
              value={sortMode}
              onChange={(event) =>
                setSortMode(
                  event.target
                    .value as SortMode
                )
              }
            >
              <option value="count-desc">
                Product count: high to low
              </option>

              <option value="count-asc">
                Product count: low to high
              </option>

              <option value="alphabetical">
                Alphabetical
              </option>

              <option value="recent">
                Recently shuffled
              </option>
            </select>
          </div>
        </div>

        <div className="rotation-selection-bar">
          <div>
            <p className="rotation-selection-title">
              {
                selectedCollectionIds.length
              }{" "}
              selected
            </p>

            <p className="rotation-selection-help">
              {
                visibleCollections.length
              }{" "}
              collection
              {visibleCollections.length ===
              1
                ? ""
                : "s"}{" "}
              visible
            </p>
          </div>

          <div className="rotation-selection-actions">
            <button
              type="button"
              className="rotation-text-button"
              onClick={
                allVisibleEligibleSelected
                  ? deselectAllVisible
                  : selectAllVisible
              }
              disabled={isBusy}
            >
              {allVisibleEligibleSelected
                ? "Deselect visible"
                : "Select visible"}
            </button>

            <button
              type="button"
              className="rotation-text-button"
              onClick={selectAllStarred}
              disabled={isBusy}
            >
              Select all starred
            </button>

            <button
              type="button"
              className="rotation-text-button"
              onClick={clearSelection}
              disabled={isBusy}
            >
              Clear selection
            </button>
          </div>
        </div>

        <div className="rotation-table-wrap">
          <table className="rotation-table">
            <thead>
              <tr>
                <th className="rotation-check-column">
                  Select
                </th>

                <th className="rotation-star-column">
                  Star
                </th>

                <th>Collection</th>
                <th>Products</th>
                <th>Top control</th>
                <th>Sort</th>
                <th>Last shuffled</th>
                <th>Status</th>

                <th className="rotation-actions-column">
                  Actions
                </th>
              </tr>
            </thead>

            <tbody>
              {visibleCollections.map(
                (collection) => {
                  const isSelected =
                    selectedIdSet.has(
                      collection.id
                    );

                  const cannotShuffle =
                    collection.productsCount <
                    2;

                  return (
                    <tr
                      key={
                        collection.id
                      }
                      className={
                        isSelected
                          ? "rotation-table-row-selected"
                          : undefined
                      }
                    >
                      <td className="rotation-check-column">
                        <input
                          type="checkbox"
                          className="rotation-checkbox"
                          checked={isSelected}
                          onChange={() =>
                            toggleCollectionSelection(
                              collection.id
                            )
                          }
                          disabled={
                            isBusy ||
                            cannotShuffle
                          }
                        />
                      </td>

                      <td className="rotation-star-column">
                        <button
                          type="button"
                          className={`rotation-star-button ${
                            collection.isStarred
                              ? "rotation-star-button-active"
                              : ""
                          }`}
                          onClick={() =>
                            void toggleStar(
                              collection
                            )
                          }
                        >
                          {collection.isStarred
                            ? "★"
                            : "☆"}
                        </button>
                      </td>

                      <td>
                        <p className="rotation-table-title">
                          {
                            collection.title
                          }
                        </p>

                        <p className="rotation-table-handle">
                          {
                            collection.handle
                          }
                        </p>
                      </td>

                      <td>
                        <strong>
                          {
                            collection.productsCount
                          }
                        </strong>
                      </td>

                      <td>
                        {collection.controlledTopCount >
                        0 ? (
                          <span className="rotation-control-pill">
                            Top{" "}
                            {
                              collection.controlledTopCount
                            }
                            :{" "}
                            {
                              collection.controlledAssignedCount
                            }{" "}
                            assigned
                          </span>
                        ) : (
                          <span className="rotation-muted-text">
                            Fully random
                          </span>
                        )}
                      </td>

                      <td>
                        <span className="rotation-sort-pill">
                          {
                            collection.sortOrder
                          }
                        </span>
                      </td>

                      <td>
                        {formatDate(
                          collection.lastShuffledAt
                        )}
                      </td>

                      <td>
                        <span className="rotation-status-pill">
                          {collection.lastStatus ??
                            "No runs"}
                        </span>
                      </td>

                      <td className="rotation-actions-column">
                        <div className="rotation-row-actions">
                          <button
                            type="button"
                            className="rotation-small-button"
                            onClick={() =>
                              void openControlEditor(
                                collection
                              )
                            }
                            disabled={
                              isBusy
                            }
                          >
                            Manage Top
                          </button>

                          <button
                            type="button"
                            className="rotation-small-button"
                            onClick={() =>
                              void undoShuffle(
                                collection
                              )
                            }
                            disabled={
                              !collection.canUndo ||
                              isBusy
                            }
                          >
                            Undo
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }
              )}
            </tbody>
          </table>
        </div>

        <div className="action-row">
          <button
            type="button"
            className="button button-primary"
            onClick={() =>
              void shuffleSelected()
            }
            disabled={
              isBusy ||
              selectedCollectionIds.length ===
                0
            }
          >
            {isShufflingBatch
              ? "Shuffling Collections..."
              : `Shuffle Selected (${selectedCollectionIds.length})`}
          </button>
        </div>
      </section>

      {batchResults.length > 0 ? (
        <section className="card card-padded">
          <div className="rotation-section-heading">
            <div>
              <p className="page-header-eyebrow">
                Shuffle results
              </p>

              <h3 className="rotation-preview-title">
                Batch status
              </h3>
            </div>

            <div className="rotation-preview-count">
              {completedCount} completed
            </div>
          </div>

          <div className="rotation-batch-summary">
            <div>
              <span>Selected</span>
              <strong>
                {batchResults.length}
              </strong>
            </div>

            <div>
              <span>Completed</span>
              <strong>
                {completedCount}
              </strong>
            </div>

            <div>
              <span>Failed</span>
              <strong>
                {failedCount}
              </strong>
            </div>
          </div>

          <div className="rotation-preview-list">
            {batchResults.map(
              (result) => (
                <article
                  key={
                    result.collectionId
                  }
                  className="rotation-preview-card"
                >
                  <div className="rotation-preview-card-header">
                    <div>
                      <h4 className="rotation-preview-card-title">
                        {
                          result.collectionTitle
                        }
                      </h4>

                      {result.message ? (
                        <p className="rotation-preview-card-meta">
                          {
                            result.message
                          }
                        </p>
                      ) : null}
                    </div>

                    <span className="rotation-status-pill">
                      {
                        result.status
                      }
                    </span>
                  </div>
                </article>
              )
            )}
          </div>
        </section>
      ) : null}

      {controlEditor ? (
        <div
          className="rotation-control-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setControlEditor(
                null
              );
            }
          }}
        >
          <section
            className="rotation-control-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="control-editor-title"
          >
            <div className="rotation-control-modal-header">
              <div>
                <p className="page-header-eyebrow">
                  Controlled positions
                </p>

                <h3
                  id="control-editor-title"
                  className="rotation-control-modal-title"
                >
                  {
                    controlEditor.collectionTitle
                  }
                </h3>

                <p className="card-description">
                  Assign exact products to
                  exact positions. Empty
                  positions are filled
                  randomly.
                </p>
              </div>

              <button
                type="button"
                className="rotation-modal-close"
                onClick={() =>
                  setControlEditor(null)
                }
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="rotation-control-count-row">
              <div>
                <label
                  className="form-label"
                  htmlFor="controlled-top-count"
                >
                  Number of controlled top
                  positions
                </label>

                <input
                  id="controlled-top-count"
                  type="number"
                  min={0}
                  max={
                    controlEditor.productCount
                  }
                  className="form-input rotation-control-count-input"
                  value={
                    controlEditor.controlledTopCount
                  }
                  onChange={(event) =>
                    updateControlledTopCount(
                      Number(
                        event.target.value
                      )
                    )
                  }
                />
              </div>

              <p className="rotation-control-explanation">
                Positions below this number
                are shuffled normally. Blank
                controlled positions are also
                randomly filled.
              </p>
            </div>

            <div className="rotation-control-editor-grid">
              <div className="rotation-position-panel">
                <h4 className="rotation-control-panel-title">
                  Top positions
                </h4>

                {controlEditor.controlledTopCount ===
                0 ? (
                  <div className="rotation-control-empty">
                    This collection is fully
                    random. Increase the
                    controlled count to assign
                    products.
                  </div>
                ) : (
                  <div className="rotation-position-list">
                    {Array.from(
                      {
                        length:
                          controlEditor.controlledTopCount,
                      },
                      (_, index) =>
                        index + 1
                    ).map(
                      (position) => {
                        const assignment =
                          controlEditor.assignments.find(
                            (item) =>
                              item.position ===
                              position
                          );

                        const product =
                          assignment
                            ? controlEditor.products.find(
                                (item) =>
                                  item.id ===
                                  assignment.productId
                              )
                            : null;

                        return (
                          <button
                            key={
                              position
                            }
                            type="button"
                            className={`rotation-position-slot ${
                              selectedControlPosition ===
                              position
                                ? "rotation-position-slot-active"
                                : ""
                            }`}
                            onClick={() =>
                              setSelectedControlPosition(
                                position
                              )
                            }
                          >
                            <span className="rotation-position-number">
                              {
                                position
                              }
                            </span>

                            {product ? (
                              <>
                                {product.imageUrl ? (
                                  <img
                                    src={
                                      product.imageUrl
                                    }
                                    alt=""
                                    className="rotation-position-image"
                                  />
                                ) : (
                                  <div className="rotation-position-image rotation-position-image-empty">
                                    No image
                                  </div>
                                )}

                                <span className="rotation-position-product">
                                  {
                                    product.title
                                  }
                                </span>

                                <span className="rotation-position-buttons">
                                  <span
                                    role="button"
                                    tabIndex={
                                      0
                                    }
                                    onClick={(
                                      event
                                    ) => {
                                      event.stopPropagation();
                                      moveAssignment(
                                        position,
                                        -1
                                      );
                                    }}
                                  >
                                    ↑
                                  </span>

                                  <span
                                    role="button"
                                    tabIndex={
                                      0
                                    }
                                    onClick={(
                                      event
                                    ) => {
                                      event.stopPropagation();
                                      moveAssignment(
                                        position,
                                        1
                                      );
                                    }}
                                  >
                                    ↓
                                  </span>

                                  <span
                                    role="button"
                                    tabIndex={
                                      0
                                    }
                                    onClick={(
                                      event
                                    ) => {
                                      event.stopPropagation();
                                      removePositionAssignment(
                                        position
                                      );
                                    }}
                                  >
                                    ×
                                  </span>
                                </span>
                              </>
                            ) : (
                              <span className="rotation-position-random">
                                Random product
                              </span>
                            )}
                          </button>
                        );
                      }
                    )}
                  </div>
                )}
              </div>

              <div className="rotation-product-picker-panel">
                <h4 className="rotation-control-panel-title">
                  Product picker
                </h4>

                {selectedControlPosition ? (
                  <>
                    <p className="rotation-picker-position-label">
                      Selecting product for
                      position{" "}
                      <strong>
                        {
                          selectedControlPosition
                        }
                      </strong>
                    </p>

                    <input
                      type="search"
                      className="form-input"
                      value={
                        productSearch
                      }
                      onChange={(
                        event
                      ) =>
                        setProductSearch(
                          event.target
                            .value
                        )
                      }
                      placeholder="Search products in this collection"
                    />

                    <div className="rotation-product-picker-list">
                      {filteredControlProducts.map(
                        (product) => (
                          <button
                            key={
                              product.id
                            }
                            type="button"
                            className="rotation-product-picker-row"
                            onClick={() =>
                              assignProductToPosition(
                                product.id
                              )
                            }
                          >
                            {product.imageUrl ? (
                              <img
                                src={
                                  product.imageUrl
                                }
                                alt=""
                                className="rotation-picker-image"
                              />
                            ) : (
                              <div className="rotation-picker-image rotation-position-image-empty">
                                No image
                              </div>
                            )}

                            <span>
                              <strong>
                                {
                                  product.title
                                }
                              </strong>

                              <small>
                                {
                                  product.handle
                                }
                              </small>
                            </span>
                          </button>
                        )
                      )}
                    </div>
                  </>
                ) : (
                  <div className="rotation-control-empty">
                    Select a position on
                    the left.
                  </div>
                )}
              </div>
            </div>

            <div className="rotation-control-modal-footer">
              <button
                type="button"
                className="button button-secondary"
                onClick={() =>
                  setControlEditor(null)
                }
                disabled={
                  isSavingControlEditor
                }
              >
                Cancel
              </button>

              <button
                type="button"
                className="button button-primary"
                onClick={() =>
                  void saveControlEditor()
                }
                disabled={
                  isSavingControlEditor
                }
              >
                {isSavingControlEditor
                  ? "Saving..."
                  : "Save Top Positions"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}