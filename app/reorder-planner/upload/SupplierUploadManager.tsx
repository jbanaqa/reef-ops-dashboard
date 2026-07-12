"use client";

import Link from "next/link";
import {
  ChangeEvent,
  Fragment,
  FormEvent,
  useMemo,
  useState,
} from "react";
import styles from "./upload.module.css";

type RecommendationVariant = {
  productId: string | null;
  variantId: string;
  inventoryItemId: string | null;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  shopifyAvailable: number;
  unitsPerVariant: number;
  physicalStock: number;
};

type RecommendationRow = {
  code: string;
  supplierItemId: string | null;
  supplierName: string;
  supplierAvailable: number;
  spreadsheetRow: number;

  mapped: boolean;
  mappingId: string | null;

  currentPhysicalStock: number | null;
  targetStockQuantity: number | null;
  recommendedOrderQuantity: number;

  variants: RecommendationVariant[];
};

type UploadResult = {
  filename: string;
  sheetName: string;

  totals: {
    supplierRows: number;
    mappedRows: number;
    unmappedRows: number;
    recommendedRows: number;
    recommendedUnits: number;
  };

  rows: RecommendationRow[];
};

type ViewFilter =
  | "recommended"
  | "mapped"
  | "unmapped"
  | "all";

export default function SupplierUploadManager() {
  const [selectedFile, setSelectedFile] =
    useState<File | null>(null);

  const [result, setResult] =
    useState<UploadResult | null>(null);

  const [viewFilter, setViewFilter] =
    useState<ViewFilter>("recommended");

  const [searchText, setSearchText] =
    useState("");

  const [expandedCodes, setExpandedCodes] =
    useState<Set<string>>(new Set());

  const [isUploading, setIsUploading] =
    useState(false);

  const [errorMessage, setErrorMessage] =
    useState("");

  const visibleRows = useMemo(() => {
    if (!result) {
      return [];
    }

    const query = searchText
      .trim()
      .toLowerCase();

    return result.rows.filter((row) => {
      if (
        viewFilter === "recommended" &&
        row.recommendedOrderQuantity <= 0
      ) {
        return false;
      }

      if (
        viewFilter === "mapped" &&
        !row.mapped
      ) {
        return false;
      }

      if (
        viewFilter === "unmapped" &&
        row.mapped
      ) {
        return false;
      }

      if (!query) {
        return true;
      }

      const searchableValues = [
        row.code,
        row.supplierName,

        ...row.variants.flatMap(
          (variant) => [
            variant.productTitle,
            variant.variantTitle,
            variant.sku,
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
    result,
    searchText,
    viewFilter,
  ]);

  function handleFileChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file =
      event.target.files?.[0] ?? null;

    setSelectedFile(file);
    setResult(null);
    setErrorMessage("");
    setExpandedCodes(new Set());
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!selectedFile) {
      setErrorMessage(
        "Choose an RVS spreadsheet before processing.",
      );

      return;
    }

    setIsUploading(true);
    setErrorMessage("");

    try {
      const formData = new FormData();
      formData.set("file", selectedFile);

      const response = await fetch(
        "/api/reorder-planner/upload",
        {
          method: "POST",
          body: formData,
        },
      );

      const responseBody =
        await response.json();

      if (!response.ok) {
        throw new Error(
          responseBody.error ||
            "The spreadsheet could not be processed.",
        );
      }

      setResult(
        responseBody as UploadResult,
      );

      setViewFilter("recommended");
    } catch (error) {
      setResult(null);

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "The spreadsheet could not be processed.",
      );
    } finally {
      setIsUploading(false);
    }
  }

  function toggleExpandedRow(
    row: RecommendationRow,
  ) {
    const key =
      `${row.code}-${row.supplierName}`;

    setExpandedCodes((current) => {
      const next = new Set(current);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
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
            Upload Supplier Spreadsheet
          </h2>

          <p className="page-description">
            Upload the current RVS stock
            report to update the supplier
            catalog and compare availability
            with live Shopify inventory.
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

      <section className="card card-padded">
        <h3 className="card-title">
          Select Stock Report
        </h3>

        <p className="card-description">
          Uploading a report saves or updates
          every RVS item by supplier code and
          calculates the quantity needed to
          reach each configured target stock.
        </p>

        <form
          className={styles.uploadForm}
          onSubmit={handleSubmit}
        >
          <label
            className={styles.filePicker}
          >
            <span className="form-label">
              Supplier spreadsheet
            </span>

            <input
              type="file"
              accept=".xls,.xlsx"
              onChange={handleFileChange}
            />

            <span
              className={styles.fileName}
            >
              {selectedFile
                ? selectedFile.name
                : "No file selected"}
            </span>
          </label>

          <button
            type="submit"
            className="button button-primary"
            disabled={
              isUploading ||
              !selectedFile
            }
          >
            {isUploading
              ? "Processing Spreadsheet..."
              : "Generate Recommendations"}
          </button>
        </form>
      </section>

      {result ? (
        <>
          <section
            className={styles.summaryGrid}
          >
            <div className="card stat-card">
              <p className="stat-label">
                Supplier Rows
              </p>

              <p className="stat-value">
                {
                  result.totals
                    .supplierRows
                }
              </p>

              <p className="stat-description">
                Unique RVS codes stored from
                this report.
              </p>
            </div>

            <div className="card stat-card">
              <p className="stat-label">
                Mapped
              </p>

              <p className="stat-value">
                {result.totals.mappedRows}
              </p>

              <p className="stat-description">
                RVS items connected to
                Shopify variants.
              </p>
            </div>

            <div className="card stat-card">
              <p className="stat-label">
                Needs Ordering
              </p>

              <p className="stat-value">
                {
                  result.totals
                    .recommendedRows
                }
              </p>

              <p className="stat-description">
                Mapped items below their
                target stock.
              </p>
            </div>

            <div className="card stat-card">
              <p className="stat-label">
                Recommended Units
              </p>

              <p className="stat-value">
                {
                  result.totals
                    .recommendedUnits
                }
              </p>

              <p className="stat-description">
                Total supplier units needed
                to reach target stock.
              </p>
            </div>
          </section>

          <section
            className={`card ${styles.resultsCard}`}
          >
            <div
              className={
                styles.resultsHeader
              }
            >
              <div>
                <h3 className="card-title">
                  Reorder Recommendations
                </h3>

                <p className="card-description">
                  {result.filename} •{" "}
                  {visibleRows.length} rows
                  shown
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
                  value={viewFilter}
                  onChange={(event) =>
                    setViewFilter(
                      event.target
                        .value as ViewFilter,
                    )
                  }
                >
                  <option value="recommended">
                    Needs ordering
                  </option>

                  <option value="mapped">
                    All mapped
                  </option>

                  <option value="unmapped">
                    Unmapped
                  </option>

                  <option value="all">
                    All supplier rows
                  </option>
                </select>
              </div>
            </div>

            {visibleRows.length === 0 ? (
              <div
                className={
                  styles.emptyState
                }
              >
                <h4>
                  No rows match this view
                </h4>

                <p>
                  Change the filter or search
                  phrase to view other
                  supplier items.
                </p>
              </div>
            ) : (
              <div
                className={styles.tableWrap}
              >
                <table
                  className={
                    styles.resultsTable
                  }
                >
                  <thead>
                    <tr>
                      <th>Supplier item</th>
                      <th>Available</th>
                      <th>
                        Shopify stock
                      </th>
                      <th>
                        Target stock
                      </th>
                      <th>
                        Recommended
                      </th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>

                  <tbody>
                    {visibleRows.map((row) => {
                      const rowKey =
                        `${row.code}-${row.supplierName}`;

                      const isExpanded =
                        expandedCodes.has(
                          rowKey,
                        );

                      return (
                        <Fragment
                          key={rowKey}
                        >
                          <tr>
                            <td>
                              <p
                                className={
                                  styles.itemName
                                }
                              >
                                {
                                  row.supplierName
                                }
                              </p>

                              <p
                                className={
                                  styles.itemCode
                                }
                              >
                                Code: {row.code}
                              </p>
                            </td>

                            <td>
                              {
                                row.supplierAvailable
                              }
                            </td>

                            <td>
                              {row.currentPhysicalStock ??
                                "—"}
                            </td>

                            <td>
                              {row.targetStockQuantity ??
                                "—"}
                            </td>

                            <td>
                              <strong
                                className={
                                  row.recommendedOrderQuantity >
                                  0
                                    ? styles.recommendedQuantity
                                    : undefined
                                }
                              >
                                {
                                  row.recommendedOrderQuantity
                                }
                              </strong>
                            </td>

                            <td>
                              {row.mapped ? (
                                row.recommendedOrderQuantity >
                                0 ? (
                                  <span
                                    className={
                                      styles.orderBadge
                                    }
                                  >
                                    Order
                                  </span>
                                ) : (
                                  <span
                                    className={
                                      styles.stockedBadge
                                    }
                                  >
                                    Target met
                                  </span>
                                )
                              ) : (
                                <span
                                  className={
                                    styles.unmappedBadge
                                  }
                                >
                                  Unmapped
                                </span>
                              )}
                            </td>

                            <td>
                              {row.mapped ? (
                                <button
                                  type="button"
                                  className={
                                    styles.expandButton
                                  }
                                  onClick={() =>
                                    toggleExpandedRow(
                                      row,
                                    )
                                  }
                                >
                                  {isExpanded
                                    ? "Hide"
                                    : "Details"}
                                </button>
                              ) : row.supplierItemId ? (
                                <Link
                                  href={`/reorder-planner/mappings?supplierItemId=${encodeURIComponent(
                                    row.supplierItemId,
                                  )}`}
                                  className={
                                    styles.mapLink
                                  }
                                >
                                  Create Mapping
                                </Link>
                              ) : (
                                <span>—</span>
                              )}
                            </td>
                          </tr>

                          {isExpanded ? (
                            <tr
                              className={
                                styles.detailsRow
                              }
                            >
                              <td colSpan={7}>
                                <div
                                  className={
                                    styles.variantDetails
                                  }
                                >
                                  {row.variants.map(
                                    (variant) => (
                                      <div
                                        key={
                                          variant.variantId
                                        }
                                        className={
                                          styles.variantDetailCard
                                        }
                                      >
                                        <p
                                          className={
                                            styles.variantTitle
                                          }
                                        >
                                          {
                                            variant.productTitle
                                          }

                                          {variant.variantTitle
                                            ? ` — ${variant.variantTitle}`
                                            : ""}
                                        </p>

                                        <p
                                          className={
                                            styles.variantNumbers
                                          }
                                        >
                                          Shopify
                                          available:{" "}
                                          <strong>
                                            {
                                              variant.shopifyAvailable
                                            }
                                          </strong>
                                          {" • "}
                                          Multiplier:{" "}
                                          <strong>
                                            ×
                                            {
                                              variant.unitsPerVariant
                                            }
                                          </strong>
                                          {" • "}
                                          Physical
                                          stock:{" "}
                                          <strong>
                                            {
                                              variant.physicalStock
                                            }
                                          </strong>
                                        </p>
                                      </div>
                                    ),
                                  )}
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}