"use client";

import Link from "next/link";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./mappings.module.css";

type SupplierItem = {
  id: string;
  supplierCode: string;
  supplierName: string;
  normalizedSupplierName: string;
  latestAvailableQty: number | null;
  lastSeenAt: string | null;
  mappingId: string | null;
};

type StoredSupplierItem = {
  id: string;
  supplierCode: string;
  supplierName: string;
  normalizedSupplierName: string;
  latestAvailableQty: number | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type VariantMapping = {
  id: string;
  mappingId: string;
  shop: string;
  productId: string | null;
  variantId: string;
  inventoryItemId: string | null;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  unitsPerVariant: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type ReorderMapping = {
  id: string;

  supplierItemId: string | null;
  supplierItem: StoredSupplierItem | null;

  supplierCode: string | null;
  supplierName: string;
  normalizedSupplierName: string;

  targetStockQuantity: number;
  isActive: boolean;

  createdAt: string;
  updatedAt: string;

  variants: VariantMapping[];
};

type ShopifyVariantSearchResult = {
  shop: string;
  productId: string;
  variantId: string;
  inventoryItemId: string | null;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
};

type EditableVariant = {
  clientId: string;

  shop: string;
  productId: string;
  variantId: string;
  inventoryItemId: string;

  productTitle: string;
  variantTitle: string;
  sku: string;

  unitsPerVariant: string;

  searchText: string;
  searchResults: ShopifyVariantSearchResult[];
  isSearching: boolean;
  searchError: string;
  isSearchOpen: boolean;
};

type MappingFormState = {
  supplierItemId: string;
  supplierCode: string;
  supplierName: string;
  supplierAvailable: number | null;
  supplierLastSeenAt: string | null;

  supplierSearchText: string;
  supplierSearchResults: SupplierItem[];
  isSupplierSearching: boolean;
  supplierSearchError: string;
  isSupplierSearchOpen: boolean;

  targetStockQuantity: string;
  isActive: boolean;

  variants: EditableVariant[];
};

type MappingManagerProps = {
  initialMappings: ReorderMapping[];
};

const DEFAULT_SHOP =
  "corals-anonymous.myshopify.com";

function createClientId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()}`;
}

function formatVariantLabel(
  productTitle: string,
  variantTitle: string | null,
) {
  if (!variantTitle) {
    return productTitle;
  }

  return `${productTitle} — ${variantTitle}`;
}

function formatSupplierLabel(
  supplierCode: string,
  supplierName: string,
) {
  return `${supplierCode} — ${supplierName}`;
}

function formatLastSeen(value: string | null) {
  if (!value) {
    return "Not recorded";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not recorded";
  }

  return date.toLocaleDateString();
}

function createEmptyVariant(): EditableVariant {
  return {
    clientId: createClientId(),

    shop: DEFAULT_SHOP,
    productId: "",
    variantId: "",
    inventoryItemId: "",

    productTitle: "",
    variantTitle: "",
    sku: "",

    unitsPerVariant: "1",

    searchText: "",
    searchResults: [],
    isSearching: false,
    searchError: "",
    isSearchOpen: false,
  };
}

function createEmptyForm(): MappingFormState {
  return {
    supplierItemId: "",
    supplierCode: "",
    supplierName: "",
    supplierAvailable: null,
    supplierLastSeenAt: null,

    supplierSearchText: "",
    supplierSearchResults: [],
    isSupplierSearching: false,
    supplierSearchError: "",
    isSupplierSearchOpen: false,

    targetStockQuantity: "",
    isActive: true,

    variants: [],
  };
}

function mappingToForm(
  mapping: ReorderMapping,
): MappingFormState {
  return {
    supplierItemId:
      mapping.supplierItemId ?? "",

    supplierCode:
      mapping.supplierCode ??
      mapping.supplierItem?.supplierCode ??
      "",

    supplierName:
      mapping.supplierItem?.supplierName ??
      mapping.supplierName,

    supplierAvailable:
      mapping.supplierItem?.latestAvailableQty ??
      null,

    supplierLastSeenAt:
      mapping.supplierItem?.lastSeenAt ?? null,

    supplierSearchText:
      mapping.supplierCode
        ? formatSupplierLabel(
            mapping.supplierCode,
            mapping.supplierName,
          )
        : mapping.supplierName,

    supplierSearchResults: [],
    isSupplierSearching: false,
    supplierSearchError: "",
    isSupplierSearchOpen: false,

    targetStockQuantity: String(
      mapping.targetStockQuantity,
    ),

    isActive: mapping.isActive,

    variants: mapping.variants.map((variant) => ({
      clientId: variant.id,

      shop: variant.shop,
      productId: variant.productId ?? "",
      variantId: variant.variantId,

      inventoryItemId:
        variant.inventoryItemId ?? "",

      productTitle: variant.productTitle,
      variantTitle: variant.variantTitle ?? "",
      sku: variant.sku ?? "",

      unitsPerVariant: String(
        variant.unitsPerVariant,
      ),

      searchText: formatVariantLabel(
        variant.productTitle,
        variant.variantTitle,
      ),

      searchResults: [],
      isSearching: false,
      searchError: "",
      isSearchOpen: false,
    })),
  };
}

function SupplierItemSelector({
  form,
  editingId,
  onUpdate,
  onSelect,
  onClear,
}: {
  form: MappingFormState;
  editingId: string | null;

  onUpdate: (
    updates: Partial<MappingFormState>,
  ) => void;

  onSelect: (item: SupplierItem) => void;
  onClear: () => void;
}) {
  useEffect(() => {
    const searchText =
      form.supplierSearchText.trim();

    if (
      form.supplierItemId ||
      searchText.length < 1
    ) {
      return;
    }

    const controller = new AbortController();

    const timeoutId = window.setTimeout(
      async () => {
        onUpdate({
          isSupplierSearching: true,
          supplierSearchError: "",
          isSupplierSearchOpen: true,
        });

        try {
          const response = await fetch(
            `/api/reorder-planner/supplier-items?q=${encodeURIComponent(
              searchText,
            )}`,
            {
              signal: controller.signal,
            },
          );

          const result = await response.json();

          if (!response.ok) {
            throw new Error(
              result.error ||
                "RVS items could not be loaded.",
            );
          }

          onUpdate({
            supplierSearchResults:
              result.items ?? [],

            isSupplierSearching: false,
            supplierSearchError: "",
            isSupplierSearchOpen: true,
          });
        } catch (error) {
          if (controller.signal.aborted) {
            return;
          }

          onUpdate({
            supplierSearchResults: [],
            isSupplierSearching: false,

            supplierSearchError:
              error instanceof Error
                ? error.message
                : "RVS items could not be loaded.",

            isSupplierSearchOpen: true,
          });
        }
      },
      300,
    );

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [
    form.supplierItemId,
    form.supplierSearchText,
    onUpdate,
  ]);

  const hasSelection = Boolean(
    form.supplierItemId,
  );

  return (
    <div className={styles.supplierSelector}>
      <div className={styles.supplierSearchWrap}>
        <label>
          <span className="form-label">
            RVS supplier item
          </span>

          <input
            className="form-input"
            autoComplete="off"
            value={form.supplierSearchText}
            placeholder="Search RVS code or supplier name..."
            onFocus={() =>
              onUpdate({
                isSupplierSearchOpen: true,
              })
            }
            onChange={(event) => {
              onUpdate({
                supplierItemId: "",
                supplierCode: "",
                supplierName: "",
                supplierAvailable: null,
                supplierLastSeenAt: null,

                supplierSearchText:
                  event.target.value,

                supplierSearchResults: [],
                supplierSearchError: "",
                isSupplierSearchOpen: true,
              });
            }}
          />
        </label>

        {form.isSupplierSearchOpen &&
        !hasSelection &&
        form.supplierSearchText.trim().length >=
          1 ? (
          <div
            className={
              styles.supplierSearchDropdown
            }
          >
            {form.isSupplierSearching ? (
              <div
                className={styles.searchMessage}
              >
                Searching stored RVS items...
              </div>
            ) : form.supplierSearchError ? (
              <div
                className={
                  styles.searchErrorMessage
                }
              >
                {form.supplierSearchError}
              </div>
            ) : form.supplierSearchResults
                .length === 0 ? (
              <div
                className={styles.searchMessage}
              >
                No stored RVS items found. Upload
                a supplier spreadsheet first.
              </div>
            ) : (
              form.supplierSearchResults.map(
                (item) => {
                  const isMappedElsewhere =
                    Boolean(item.mappingId) &&
                    item.mappingId !== editingId;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={
                        styles.supplierSearchResult
                      }
                      disabled={
                        isMappedElsewhere
                      }
                      onMouseDown={(event) => {
                        event.preventDefault();

                        if (
                          !isMappedElsewhere
                        ) {
                          onSelect(item);
                        }
                      }}
                    >
                      <span
                        className={
                          styles.supplierResultTop
                        }
                      >
                        <strong>
                          {item.supplierCode}
                        </strong>

                        {isMappedElsewhere ? (
                          <span
                            className={
                              styles.alreadyMappedBadge
                            }
                          >
                            Already mapped
                          </span>
                        ) : null}
                      </span>

                      <span
                        className={
                          styles.supplierResultName
                        }
                      >
                        {item.supplierName}
                      </span>

                      <span
                        className={
                          styles.supplierResultDetails
                        }
                      >
                        Available:{" "}
                        {item.latestAvailableQty ??
                          "Unknown"}
                        {" • "}
                        Last seen:{" "}
                        {formatLastSeen(
                          item.lastSeenAt,
                        )}
                      </span>
                    </button>
                  );
                },
              )
            )}
          </div>
        ) : null}
      </div>

      {hasSelection ? (
        <div
          className={
            styles.selectedSupplierItem
          }
        >
          <div
            className={
              styles.selectedSupplierTop
            }
          >
            <div>
              <p
                className={
                  styles.selectedSupplierCode
                }
              >
                RVS Code: {form.supplierCode}
              </p>

              <p
                className={
                  styles.selectedSupplierName
                }
              >
                {form.supplierName}
              </p>
            </div>

            <button
              type="button"
              className={
                styles.changeSupplierButton
              }
              onClick={onClear}
            >
              Change
            </button>
          </div>

          <div
            className={
              styles.selectedSupplierMetadata
            }
          >
            <span>
              <strong>Latest availability:</strong>{" "}
              {form.supplierAvailable ??
                "Unknown"}
            </span>

            <span>
              <strong>Last seen:</strong>{" "}
              {formatLastSeen(
                form.supplierLastSeenAt,
              )}
            </span>
          </div>
        </div>
      ) : (
        <p className={styles.selectionHelp}>
          Select the exact supplier item stored
          from an uploaded RVS spreadsheet.
        </p>
      )}
    </div>
  );
}

function VariantSelector({
  variant,
  index,
  onUpdate,
  onSelect,
  onRemove,
}: {
  variant: EditableVariant;
  index: number;

  onUpdate: (
    clientId: string,
    updates: Partial<EditableVariant>,
  ) => void;

  onSelect: (
    clientId: string,
    selectedVariant: ShopifyVariantSearchResult,
  ) => void;

  onRemove: (clientId: string) => void;
}) {
  useEffect(() => {
    const searchText = variant.searchText.trim();

    if (
      searchText.length < 2 ||
      variant.variantId
    ) {
      return;
    }

    const controller = new AbortController();

    const timeoutId = window.setTimeout(
      async () => {
        onUpdate(variant.clientId, {
          isSearching: true,
          searchError: "",
          isSearchOpen: true,
        });

        try {
          const response = await fetch(
            `/api/reorder-planner/shopify-variants?q=${encodeURIComponent(
              searchText,
            )}`,
            {
              signal: controller.signal,
            },
          );

          const result = await response.json();

          if (!response.ok) {
            throw new Error(
              result.error ||
                "Shopify variants could not be loaded.",
            );
          }

          onUpdate(variant.clientId, {
            searchResults:
              result.variants ?? [],

            isSearching: false,
            searchError: "",
            isSearchOpen: true,
          });
        } catch (error) {
          if (controller.signal.aborted) {
            return;
          }

          onUpdate(variant.clientId, {
            searchResults: [],
            isSearching: false,

            searchError:
              error instanceof Error
                ? error.message
                : "Shopify variants could not be loaded.",

            isSearchOpen: true,
          });
        }
      },
      350,
    );

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [
    variant.clientId,
    variant.searchText,
    variant.variantId,
    onUpdate,
  ]);

  const hasSelection = Boolean(
    variant.variantId,
  );

  return (
    <div className={styles.variantCard}>
      <div
        className={styles.variantCardHeader}
      >
        <h4>Variant {index + 1}</h4>

        <button
          type="button"
          className={
            styles.removeVariantButton
          }
          onClick={() =>
            onRemove(variant.clientId)
          }
        >
          Remove
        </button>
      </div>

      <div
        className={
          styles.variantSelectorLayout
        }
      >
        <div
          className={styles.searchFieldWrap}
        >
          <label>
            <span className="form-label">
              Search Shopify products
            </span>

            <input
              className="form-input"
              value={variant.searchText}
              autoComplete="off"
              placeholder="Search product, variant, or SKU..."
              onFocus={() =>
                onUpdate(variant.clientId, {
                  isSearchOpen: true,
                })
              }
              onChange={(event) => {
                onUpdate(variant.clientId, {
                  searchText:
                    event.target.value,

                  shop: DEFAULT_SHOP,
                  productId: "",
                  variantId: "",
                  inventoryItemId: "",

                  productTitle: "",
                  variantTitle: "",
                  sku: "",

                  searchResults: [],
                  searchError: "",
                  isSearchOpen: true,
                });
              }}
            />
          </label>

          {variant.isSearchOpen &&
          !hasSelection &&
          variant.searchText.trim().length >=
            2 ? (
            <div
              className={
                styles.searchDropdown
              }
            >
              {variant.isSearching ? (
                <div
                  className={
                    styles.searchMessage
                  }
                >
                  Searching Shopify...
                </div>
              ) : variant.searchError ? (
                <div
                  className={
                    styles.searchErrorMessage
                  }
                >
                  {variant.searchError}
                </div>
              ) : variant.searchResults
                  .length === 0 ? (
                <div
                  className={
                    styles.searchMessage
                  }
                >
                  No matching variants found.
                </div>
              ) : (
                variant.searchResults.map(
                  (result) => (
                    <button
                      key={`${result.shop}-${result.variantId}`}
                      type="button"
                      className={
                        styles.searchResult
                      }
                      onMouseDown={(event) => {
                        event.preventDefault();

                        onSelect(
                          variant.clientId,
                          result,
                        );
                      }}
                    >
                      <span
                        className={
                          styles.searchResultTitle
                        }
                      >
                        {result.productTitle}
                      </span>

                      <span
                        className={
                          styles.searchResultDetails
                        }
                      >
                        {result.variantTitle
                          ? result.variantTitle
                          : "Default variant"}

                        {result.sku
                          ? ` • SKU: ${result.sku}`
                          : ""}
                      </span>
                    </button>
                  ),
                )
              )}
            </div>
          ) : null}
        </div>

        <label>
          <span className="form-label">
            Physical units
          </span>

          <input
            type="number"
            min="1"
            step="1"
            className="form-input"
            value={variant.unitsPerVariant}
            onChange={(event) =>
              onUpdate(variant.clientId, {
                unitsPerVariant:
                  event.target.value,
              })
            }
          />

          <p className="field-help-text">
            Single = 1, five-pack = 5,
            ten-pack = 10.
          </p>
        </label>
      </div>

      {hasSelection ? (
        <div
          className={styles.selectedVariant}
        >
          <div
            className={
              styles.selectedVariantTop
            }
          >
            <div>
              <p
                className={
                  styles.selectedVariantTitle
                }
              >
                {variant.productTitle}
              </p>

              <p
                className={
                  styles.selectedVariantSubtitle
                }
              >
                {variant.variantTitle ||
                  "Default variant"}
              </p>
            </div>

            <button
              type="button"
              className={
                styles.changeVariantButton
              }
              onClick={() =>
                onUpdate(variant.clientId, {
                  shop: DEFAULT_SHOP,
                  productId: "",
                  variantId: "",
                  inventoryItemId: "",

                  productTitle: "",
                  variantTitle: "",
                  sku: "",

                  searchText: "",
                  searchResults: [],
                  searchError: "",
                  isSearching: false,
                  isSearchOpen: true,
                })
              }
            >
              Change
            </button>
          </div>

          <div
            className={
              styles.selectedMetadata
            }
          >
            <span>
              <strong>Variant ID:</strong>{" "}
              {variant.variantId}
            </span>

            <span>
              <strong>Inventory item:</strong>{" "}
              {variant.inventoryItemId ||
                "Unavailable"}
            </span>

            <span>
              <strong>SKU:</strong>{" "}
              {variant.sku || "None"}
            </span>
          </div>
        </div>
      ) : (
        <p className={styles.selectionHelp}>
          Select an exact Shopify variant from
          the search results.
        </p>
      )}
    </div>
  );
}

export default function MappingManager({
  initialMappings,
}: MappingManagerProps) {
  const [mappings, setMappings] =
    useState<ReorderMapping[]>(
      initialMappings,
    );

  const [form, setForm] =
    useState<MappingFormState>(
      createEmptyForm,
    );

  const [isFormOpen, setIsFormOpen] =
    useState(false);

  const [editingId, setEditingId] =
    useState<string | null>(null);

  const [
    expandedMappingIds,
    setExpandedMappingIds,
  ] = useState<Set<string>>(new Set());

  const [searchText, setSearchText] =
    useState("");

  const [statusFilter, setStatusFilter] =
    useState<
      "all" | "active" | "inactive"
    >("all");

  const [isSaving, setIsSaving] =
    useState(false);

  const [busyMappingId, setBusyMappingId] =
    useState<string | null>(null);

  const [errorMessage, setErrorMessage] =
    useState("");

  const [
    successMessage,
    setSuccessMessage,
  ] = useState("");

  const prefillHandledRef = useRef(false);

  const filteredMappings = useMemo(() => {
    const query = searchText
      .trim()
      .toLowerCase();

    return mappings.filter((mapping) => {
      if (
        statusFilter === "active" &&
        !mapping.isActive
      ) {
        return false;
      }

      if (
        statusFilter === "inactive" &&
        mapping.isActive
      ) {
        return false;
      }

      if (!query) {
        return true;
      }

      const searchableValues = [
        mapping.supplierCode,
        mapping.supplierName,

        ...mapping.variants.flatMap(
          (variant) => [
            variant.productTitle,
            variant.variantTitle,
            variant.sku,
            variant.variantId,
          ],
        ),
      ];

      return searchableValues.some((value) =>
        value
          ?.toLowerCase()
          .includes(query),
      );
    });
  }, [
    mappings,
    searchText,
    statusFilter,
  ]);

  const updateForm = useCallback(
    (
      updates: Partial<MappingFormState>,
    ) => {
      setForm((current) => ({
        ...current,
        ...updates,
      }));
    },
    [],
  );

  function updateFormField<
    K extends keyof MappingFormState,
  >(
    field: K,
    value: MappingFormState[K],
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  const updateVariant = useCallback(
    (
      clientId: string,
      updates: Partial<EditableVariant>,
    ) => {
      setForm((current) => ({
        ...current,

        variants: current.variants.map(
          (variant) =>
            variant.clientId === clientId
              ? {
                  ...variant,
                  ...updates,
                }
              : variant,
        ),
      }));
    },
    [],
  );

  const selectSupplierItem = useCallback(
    (item: SupplierItem) => {
      updateForm({
        supplierItemId: item.id,
        supplierCode: item.supplierCode,
        supplierName: item.supplierName,

        supplierAvailable:
          item.latestAvailableQty,

        supplierLastSeenAt:
          item.lastSeenAt,

        supplierSearchText:
          formatSupplierLabel(
            item.supplierCode,
            item.supplierName,
          ),

        supplierSearchResults: [],
        isSupplierSearching: false,
        supplierSearchError: "",
        isSupplierSearchOpen: false,
      });
    },
    [updateForm],
  );

  const clearSupplierItem =
    useCallback(() => {
      updateForm({
        supplierItemId: "",
        supplierCode: "",
        supplierName: "",
        supplierAvailable: null,
        supplierLastSeenAt: null,

        supplierSearchText: "",
        supplierSearchResults: [],
        isSupplierSearching: false,
        supplierSearchError: "",
        isSupplierSearchOpen: true,
      });
    }, [updateForm]);

  const selectShopifyVariant =
    useCallback(
      (
        clientId: string,
        selectedVariant: ShopifyVariantSearchResult,
      ) => {
        updateVariant(clientId, {
          shop: selectedVariant.shop,

          productId:
            selectedVariant.productId,

          variantId:
            selectedVariant.variantId,

          inventoryItemId:
            selectedVariant.inventoryItemId ??
            "",

          productTitle:
            selectedVariant.productTitle,

          variantTitle:
            selectedVariant.variantTitle ??
            "",

          sku: selectedVariant.sku ?? "",

          searchText: formatVariantLabel(
            selectedVariant.productTitle,
            selectedVariant.variantTitle,
          ),

          searchResults: [],
          searchError: "",
          isSearching: false,
          isSearchOpen: false,
        });
      },
      [updateVariant],
    );

  useEffect(() => {
    if (prefillHandledRef.current) {
      return;
    }

    prefillHandledRef.current = true;

    const params = new URLSearchParams(
      window.location.search,
    );

    const supplierItemId =
      params.get("supplierItemId")?.trim();

    if (!supplierItemId) {
      return;
    }

    const controller = new AbortController();

    async function loadSupplierItem() {
      setErrorMessage("");
      setEditingId(null);
      setForm(createEmptyForm());
      setIsFormOpen(true);

      try {
        const response = await fetch(
          `/api/reorder-planner/supplier-items?id=${encodeURIComponent(
            supplierItemId!,
          )}`,
          {
            signal: controller.signal,
          },
        );

        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            result.error ||
              "The RVS supplier item could not be loaded.",
          );
        }

        const item = result.items?.[0] as
          | SupplierItem
          | undefined;

        if (!item) {
          throw new Error(
            "The selected RVS supplier item could not be found.",
          );
        }

        if (item.mappingId) {
          const existingMapping =
            mappings.find(
              (mapping) =>
                mapping.id === item.mappingId,
            );

          if (existingMapping) {
            setEditingId(
              existingMapping.id,
            );

            setForm(
              mappingToForm(existingMapping),
            );

            setSuccessMessage(
              "This RVS item already has a mapping. Its existing mapping was opened.",
            );

            return;
          }
        }

        selectSupplierItem(item);

        setSuccessMessage(
          "RVS supplier item selected. Add its target stock quantity and Shopify variants.",
        );
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setErrorMessage(
          error instanceof Error
            ? error.message
            : "The RVS supplier item could not be loaded.",
        );
      } finally {
        window.history.replaceState(
          {},
          "",
          window.location.pathname,
        );
      }
    }

    void loadSupplierItem();

    return () => {
      controller.abort();
    };
  }, [mappings, selectSupplierItem]);

  function openNewMappingForm() {
    setEditingId(null);
    setForm(createEmptyForm());
    setErrorMessage("");
    setSuccessMessage("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setEditingId(null);
    setForm(createEmptyForm());
    setErrorMessage("");
    setIsFormOpen(false);
  }

  function addVariantRow() {
    setForm((current) => ({
      ...current,

      variants: [
        ...current.variants,
        createEmptyVariant(),
      ],
    }));
  }

  function removeVariantRow(
    clientId: string,
  ) {
    setForm((current) => ({
      ...current,

      variants: current.variants.filter(
        (variant) =>
          variant.clientId !== clientId,
      ),
    }));
  }

  function beginEditing(
    mapping: ReorderMapping,
  ) {
    setEditingId(mapping.id);
    setForm(mappingToForm(mapping));
    setErrorMessage("");
    setSuccessMessage("");
    setIsFormOpen(true);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  function toggleExpandedMapping(
    mappingId: string,
  ) {
    setExpandedMappingIds((current) => {
      const next = new Set(current);

      if (next.has(mappingId)) {
        next.delete(mappingId);
      } else {
        next.add(mappingId);
      }

      return next;
    });
  }

  function buildPayload(
    currentForm: MappingFormState,
  ) {
    return {
      supplierItemId:
        currentForm.supplierItemId ||
        null,

      supplierCode:
        currentForm.supplierCode || null,

      supplierName:
        currentForm.supplierName.trim(),

      targetStockQuantity: Number(
        currentForm.targetStockQuantity,
      ),

      isActive: currentForm.isActive,

      variants: currentForm.variants.map(
        (variant) => ({
          shop:
            variant.shop ||
            DEFAULT_SHOP,

          productId:
            variant.productId || null,

          variantId:
            variant.variantId,

          inventoryItemId:
            variant.inventoryItemId ||
            null,

          productTitle:
            variant.productTitle,

          variantTitle:
            variant.variantTitle || null,

          sku: variant.sku || null,

          unitsPerVariant: Number(
            variant.unitsPerVariant,
          ),

          isActive: true,
        }),
      ),
    };
  }

  function validateForm():
    | string
    | null {
    if (!form.supplierItemId) {
      return "Select an RVS supplier item from the stored catalog.";
    }

    if (
      form.targetStockQuantity === "" ||
      !Number.isInteger(
        Number(form.targetStockQuantity),
      ) ||
      Number(form.targetStockQuantity) < 0
    ) {
      return "Target stock quantity must be a whole number of zero or greater.";
    }

    if (form.variants.length === 0) {
      return "Add at least one Shopify variant.";
    }

    for (
      let index = 0;
      index < form.variants.length;
      index += 1
    ) {
      const variant =
        form.variants[index];

      if (!variant.variantId) {
        return `Select a Shopify variant for row ${
          index + 1
        }.`;
      }

      if (!variant.productId) {
        return `The selected Shopify product is missing its product ID on row ${
          index + 1
        }.`;
      }

      const unitsPerVariant = Number(
        variant.unitsPerVariant,
      );

      if (
        !Number.isInteger(
          unitsPerVariant,
        ) ||
        unitsPerVariant < 1
      ) {
        return `Physical units must be a whole number of at least 1 for variant row ${
          index + 1
        }.`;
      }
    }

    return null;
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    setErrorMessage("");
    setSuccessMessage("");

    const validationError =
      validateForm();

    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch(
        editingId
          ? `/api/reorder-planner/mappings/${editingId}`
          : "/api/reorder-planner/mappings",
        {
          method: editingId
            ? "PUT"
            : "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify(
            buildPayload(form),
          ),
        },
      );

      const result =
        await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ||
            "The mapping could not be saved.",
        );
      }

      const savedMapping =
        result.mapping as ReorderMapping;

      setMappings((current) => {
        const remaining =
          current.filter(
            (mapping) =>
              mapping.id !==
              savedMapping.id,
          );

        return [
          ...remaining,
          savedMapping,
        ].sort((first, second) =>
          first.supplierName.localeCompare(
            second.supplierName,
          ),
        );
      });

      setSuccessMessage(
        editingId
          ? "Mapping updated successfully."
          : "Mapping created successfully.",
      );

      setEditingId(null);
      setForm(createEmptyForm());
      setIsFormOpen(false);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "The mapping could not be saved.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleMappingActive(
    mapping: ReorderMapping,
  ) {
    setBusyMappingId(mapping.id);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const response = await fetch(
        `/api/reorder-planner/mappings/${mapping.id}`,
        {
          method: "PUT",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            supplierItemId:
              mapping.supplierItemId,

            supplierCode:
              mapping.supplierCode,

            supplierName:
              mapping.supplierName,

            targetStockQuantity:
              mapping.targetStockQuantity,

            isActive:
              !mapping.isActive,

            variants:
              mapping.variants.map(
                (variant) => ({
                  shop: variant.shop,

                  productId:
                    variant.productId,

                  variantId:
                    variant.variantId,

                  inventoryItemId:
                    variant.inventoryItemId,

                  productTitle:
                    variant.productTitle,

                  variantTitle:
                    variant.variantTitle,

                  sku: variant.sku,

                  unitsPerVariant:
                    variant.unitsPerVariant,

                  isActive:
                    variant.isActive,
                }),
              ),
          }),
        },
      );

      const result =
        await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ||
            "The mapping status could not be changed.",
        );
      }

      const updatedMapping =
        result.mapping as ReorderMapping;

      setMappings((current) =>
        current.map((item) =>
          item.id === updatedMapping.id
            ? updatedMapping
            : item,
        ),
      );

      setSuccessMessage(
        updatedMapping.isActive
          ? "Mapping activated."
          : "Mapping deactivated.",
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "The mapping status could not be changed.",
      );
    } finally {
      setBusyMappingId(null);
    }
  }

  async function deleteMapping(
    mapping: ReorderMapping,
  ) {
    const confirmed = window.confirm(
      `Permanently delete the mapping for "${mapping.supplierName}"?`,
    );

    if (!confirmed) {
      return;
    }

    setBusyMappingId(mapping.id);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const response = await fetch(
        `/api/reorder-planner/mappings/${mapping.id}`,
        {
          method: "DELETE",
        },
      );

      const result =
        await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ||
            "The mapping could not be deleted.",
        );
      }

      setMappings((current) =>
        current.filter(
          (item) =>
            item.id !== mapping.id,
        ),
      );

      if (editingId === mapping.id) {
        closeForm();
      }

      setSuccessMessage(
        "Mapping permanently deleted.",
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "The mapping could not be deleted.",
      );
    } finally {
      setBusyMappingId(null);
    }
  }

  return (
    <div className={styles.page}>
      <section
        className={styles.pageHeader}
      >
        <div>
          <p className="page-header-eyebrow">
            Reorder Planner
          </p>

          <h2 className="page-title">
            Manage Mappings
          </h2>

          <p className="page-description">
            Connect each stored RVS supplier
            item to the exact Shopify variants
            that represent the same physical
            livestock.
          </p>
        </div>

        <Link
          href="/reorder-planner"
          className="button button-secondary"
        >
          Back to Reorder Planner
        </Link>
      </section>

      {errorMessage ? (
        <div
          className={styles.errorBanner}
        >
          {errorMessage}
        </div>
      ) : null}

      {successMessage ? (
        <div
          className={styles.successBanner}
        >
          {successMessage}
        </div>
      ) : null}

      <section
        className={`card ${styles.formPanel}`}
      >
        <button
          type="button"
          className={
            styles.formPanelToggle
          }
          onClick={() => {
            if (isFormOpen) {
              closeForm();
            } else {
              openNewMappingForm();
            }
          }}
        >
          <span>
            <strong>
              {editingId
                ? "Edit Mapping"
                : "Add Mapping"}
            </strong>

            <small>
              {isFormOpen
                ? "Close the mapping form"
                : "Select an RVS item and connect it to Shopify"}
            </small>
          </span>

          <span
            className={
              styles.toggleSymbol
            }
          >
            {isFormOpen ? "−" : "+"}
          </span>
        </button>

        {isFormOpen ? (
          <form
            className={styles.mappingForm}
            onSubmit={handleSubmit}
          >
            <SupplierItemSelector
              form={form}
              editingId={editingId}
              onUpdate={updateForm}
              onSelect={selectSupplierItem}
              onClear={clearSupplierItem}
            />

            <div
              className={styles.formGrid}
            >
              <label>
                <span className="form-label">
                  Target stock quantity
                </span>

                <input
                  type="number"
                  min="0"
                  step="1"
                  className="form-input"
                  value={
                    form.targetStockQuantity
                  }
                  onChange={(event) =>
                    updateFormField(
                      "targetStockQuantity",
                      event.target.value,
                    )
                  }
                  placeholder="100"
                />

                <p className="field-help-text">
                  The total number of physical
                  animals you aim to have in
                  stock.
                </p>
              </label>

              <label
                className={
                  styles.activeField
                }
              >
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) =>
                    updateFormField(
                      "isActive",
                      event.target.checked,
                    )
                  }
                />

                <span>
                  <strong>
                    Active mapping
                  </strong>

                  <small>
                    Include this mapping in
                    reorder calculations.
                  </small>
                </span>
              </label>
            </div>

            <div
              className={
                styles.variantSection
              }
            >
              <div
                className={
                  styles.variantSectionHeader
                }
              >
                <div>
                  <h3>
                    Shopify Variants
                  </h3>

                  <p>
                    Select every Shopify
                    variant that draws from
                    this physical RVS stock
                    pool.
                  </p>
                </div>

                {form.variants.length >
                0 ? (
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={addVariantRow}
                  >
                    Add Another Variant
                  </button>
                ) : null}
              </div>

              {form.variants.length ===
              0 ? (
                <div
                  className={
                    styles.noVariants
                  }
                >
                  <p>
                    No Shopify variants have
                    been selected.
                  </p>

                  <button
                    type="button"
                    className="button button-primary"
                    onClick={addVariantRow}
                  >
                    Add Shopify Variant
                  </button>
                </div>
              ) : (
                <div
                  className={
                    styles.variantList
                  }
                >
                  {form.variants.map(
                    (variant, index) => (
                      <VariantSelector
                        key={
                          variant.clientId
                        }
                        variant={variant}
                        index={index}
                        onUpdate={
                          updateVariant
                        }
                        onSelect={
                          selectShopifyVariant
                        }
                        onRemove={
                          removeVariantRow
                        }
                      />
                    ),
                  )}
                </div>
              )}
            </div>

            <div className="action-row">
              <button
                type="submit"
                className="button button-primary"
                disabled={isSaving}
              >
                {isSaving
                  ? "Saving..."
                  : editingId
                    ? "Save Changes"
                    : "Create Mapping"}
              </button>

              <button
                type="button"
                className="button button-secondary"
                onClick={closeForm}
                disabled={isSaving}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </section>

      <section
        className={`card ${styles.listCard}`}
      >
        <div
          className={styles.listHeader}
        >
          <div>
            <h3 className="card-title">
              Saved Mappings
            </h3>

            <p className="card-description">
              {filteredMappings.length} of{" "}
              {mappings.length} mappings
              shown.
            </p>
          </div>

          <div
            className={styles.filters}
          >
            <input
              className="form-input"
              value={searchText}
              onChange={(event) =>
                setSearchText(
                  event.target.value,
                )
              }
              placeholder="Search RVS code, supplier, or Shopify item..."
            />

            <select
              className="form-select"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(
                  event.target.value as
                    | "all"
                    | "active"
                    | "inactive",
                )
              }
            >
              <option value="all">
                All statuses
              </option>

              <option value="active">
                Active only
              </option>

              <option value="inactive">
                Inactive only
              </option>
            </select>
          </div>
        </div>

        {filteredMappings.length ===
        0 ? (
          <div
            className={styles.emptyState}
          >
            <h4>No mappings found</h4>

            <p>
              Add your first mapping or change
              the current filters.
            </p>
          </div>
        ) : (
          <div
            className={styles.mappingList}
          >
            {filteredMappings.map(
              (mapping) => {
                const isExpanded =
                  expandedMappingIds.has(
                    mapping.id,
                  );

                return (
                  <article
                    key={mapping.id}
                    className={`${
                      styles.mappingCard
                    } ${
                      !mapping.isActive
                        ? styles.inactiveMapping
                        : ""
                    }`}
                  >
                    <div
                      className={
                        styles.mappingTopRow
                      }
                    >
                      <div>
                        <div
                          className={
                            styles.mappingTitleRow
                          }
                        >
                          <h4>
                            {
                              mapping.supplierName
                            }
                          </h4>

                          <span
                            className={
                              mapping.isActive
                                ? styles.activeBadge
                                : styles.inactiveBadge
                            }
                          >
                            {mapping.isActive
                              ? "Active"
                              : "Inactive"}
                          </span>
                        </div>

                        <div
                          className={
                            styles.compactSummary
                          }
                        >
                          <span>
                            RVS Code:{" "}
                            <strong>
                              {mapping.supplierCode ||
                                "Not linked"}
                            </strong>
                          </span>

                          <span>
                            Target stock:{" "}
                            <strong>
                              {
                                mapping.targetStockQuantity
                              }
                            </strong>
                          </span>

                          <span>
                            Variants:{" "}
                            <strong>
                              {
                                mapping.variants
                                  .length
                              }
                            </strong>
                          </span>
                        </div>
                      </div>

                      <div
                        className={
                          styles.mappingActions
                        }
                      >
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() =>
                            toggleExpandedMapping(
                              mapping.id,
                            )
                          }
                        >
                          {isExpanded
                            ? "Collapse"
                            : "Expand"}
                        </button>

                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() =>
                            beginEditing(
                              mapping,
                            )
                          }
                          disabled={
                            busyMappingId ===
                            mapping.id
                          }
                        >
                          Edit
                        </button>

                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() =>
                            toggleMappingActive(
                              mapping,
                            )
                          }
                          disabled={
                            busyMappingId ===
                            mapping.id
                          }
                        >
                          {mapping.isActive
                            ? "Deactivate"
                            : "Activate"}
                        </button>

                        <button
                          type="button"
                          className={
                            styles.deleteButton
                          }
                          onClick={() =>
                            deleteMapping(
                              mapping,
                            )
                          }
                          disabled={
                            busyMappingId ===
                            mapping.id
                          }
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {isExpanded ? (
                      <div
                        className={
                          styles.expandedMappingContent
                        }
                      >
                        <div
                          className={
                            styles.variantTableWrap
                          }
                        >
                          <table
                            className={
                              styles.variantTable
                            }
                          >
                            <thead>
                              <tr>
                                <th>
                                  Shopify product
                                </th>

                                <th>
                                  Variant
                                </th>

                                <th>SKU</th>

                                <th>
                                  Variant ID
                                </th>

                                <th>
                                  Physical units
                                </th>
                              </tr>
                            </thead>

                            <tbody>
                              {mapping.variants.map(
                                (variant) => (
                                  <tr
                                    key={
                                      variant.id
                                    }
                                  >
                                    <td>
                                      {
                                        variant.productTitle
                                      }
                                    </td>

                                    <td>
                                      {variant.variantTitle ||
                                        "Default"}
                                    </td>

                                    <td>
                                      {variant.sku ||
                                        "—"}
                                    </td>

                                    <td
                                      className={
                                        styles.idCell
                                      }
                                    >
                                      {
                                        variant.variantId
                                      }
                                    </td>

                                    <td>
                                      <strong>
                                        ×
                                        {
                                          variant.unitsPerVariant
                                        }
                                      </strong>
                                    </td>
                                  </tr>
                                ),
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              },
            )}
          </div>
        )}
      </section>
    </div>
  );
}