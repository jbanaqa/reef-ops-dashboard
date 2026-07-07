import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { finalizeReadyInventoryWindows } from "@/lib/finalize-inventory-windows";

export const dynamic = "force-dynamic";

type InventoryMonitorPageProps = {
  searchParams?: Promise<{
    view?: string;
  }>;
};

const VALID_VIEWS = ["queue", "reviewed", "removed"] as const;

type InventoryView = (typeof VALID_VIEWS)[number];

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function getView(rawView?: string): InventoryView {
  if (VALID_VIEWS.includes(rawView as InventoryView)) {
    return rawView as InventoryView;
  }

  return "queue";
}

function getReviewStatusForView(view: InventoryView) {
  if (view === "reviewed") {
    return "Reviewed";
  }

  if (view === "removed") {
    return "Removed";
  }

  return "Unreviewed";
}

function getViewTitle(view: InventoryView) {
  if (view === "reviewed") {
    return "Reviewed inventory events";
  }

  if (view === "removed") {
    return "Removed inventory events";
  }

  return "Unreviewed unknown decrements";
}

function getEmptyTitle(view: InventoryView) {
  if (view === "reviewed") {
    return "No reviewed events yet";
  }

  if (view === "removed") {
    return "No removed events yet";
  }

  return "No unknown decrements yet";
}

function getEmptyMessage(view: InventoryView) {
  if (view === "reviewed") {
    return "Events you mark as reviewed will appear here so you can reference them later or restore them if needed.";
  }

  if (view === "removed") {
    return "Removed events will appear here instead of being permanently deleted.";
  }

  return "Once inventory webhooks are connected, unexplained stock drops will appear here after the settling window finishes.";
}

async function handleBulkInventoryAction(formData: FormData) {
  "use server";

  const action = String(formData.get("bulkAction") || "");
  const currentView = getView(String(formData.get("currentView") || "queue"));

  const eventIds = formData
    .getAll("eventIds")
    .map((value) => String(value))
    .filter(Boolean);

  if (eventIds.length === 0) {
    return;
  }

  if (action === "mark-reviewed") {
    await prisma.inventoryEvent.updateMany({
      where: {
        id: {
          in: eventIds,
        },
      },
      data: {
        reviewStatus: "Reviewed",
        reviewedAt: new Date(),
      },
    });
  }

  if (action === "remove") {
    await prisma.inventoryEvent.updateMany({
      where: {
        id: {
          in: eventIds,
        },
      },
      data: {
        reviewStatus: "Removed",
        reviewedAt: new Date(),
      },
    });
  }

  if (action === "restore") {
    await prisma.inventoryEvent.updateMany({
      where: {
        id: {
          in: eventIds,
        },
      },
      data: {
        reviewStatus: "Unreviewed",
        reviewedAt: null,
      },
    });
  }

  revalidatePath("/inventory-monitor");
  revalidatePath(`/inventory-monitor?view=${currentView}`);
}

async function emptyRemovedInventoryEvents() {
  "use server";

  await prisma.inventoryEvent.deleteMany({
    where: {
      eventType: {
        in: ["UnknownDecrement", "PartialUnknownDecrement"],
      },
      reviewStatus: "Removed",
    },
  });

  revalidatePath("/inventory-monitor");
  revalidatePath("/inventory-monitor?view=removed");
}

export default async function InventoryMonitorPage({
  searchParams,
}: InventoryMonitorPageProps) {
  await finalizeReadyInventoryWindows();

  const resolvedSearchParams = await searchParams;
  const currentView = getView(resolvedSearchParams?.view);
  const currentReviewStatus = getReviewStatusForView(currentView);

  const events = await prisma.inventoryEvent.findMany({
    where: {
      eventType: {
        in: ["UnknownDecrement", "PartialUnknownDecrement"],
      },
      reviewStatus: currentReviewStatus,
    },
    orderBy: {
      detectedAt: "desc",
    },
    take: 50,
  });

  const unknownCount = await prisma.inventoryEvent.count({
    where: {
      eventType: {
        in: ["UnknownDecrement", "PartialUnknownDecrement"],
      },
      reviewStatus: "Unreviewed",
    },
  });

  const reviewedCount = await prisma.inventoryEvent.count({
    where: {
      eventType: {
        in: ["UnknownDecrement", "PartialUnknownDecrement"],
      },
      reviewStatus: "Reviewed",
    },
  });

  const removedCount = await prisma.inventoryEvent.count({
    where: {
      eventType: {
        in: ["UnknownDecrement", "PartialUnknownDecrement"],
      },
      reviewStatus: "Removed",
    },
  });

  return (
    <div className="inventory-monitor-page">
      <section className="page-header">
        <p className="eyebrow">Inventory Monitor</p>
        <h2>Unknown Inventory Decrements</h2>
        <p className="page-intro">
          Track inventory decreases that are not explained by Shopify orders.
          This page helps identify silent manual corrections, unreported losses,
          and suspicious stock changes.
        </p>
      </section>

      <section className="content-card">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Review Queue</p>
            <h3>{getViewTitle(currentView)}</h3>
          </div>
        </div>

        <div className="inventory-view-tabs" aria-label="Inventory monitor views">
          <Link
            href="/inventory-monitor?view=queue"
            className={`inventory-view-tab ${
              currentView === "queue" ? "inventory-view-tab-active" : ""
            }`}
          >
            Review Queue
            <span>{unknownCount}</span>
          </Link>

          <Link
            href="/inventory-monitor?view=reviewed"
            className={`inventory-view-tab ${
              currentView === "reviewed" ? "inventory-view-tab-active" : ""
            }`}
          >
            Reviewed
            <span>{reviewedCount}</span>
          </Link>

          <Link
            href="/inventory-monitor?view=removed"
            className={`inventory-view-tab ${
              currentView === "removed" ? "inventory-view-tab-active" : ""
            }`}
          >
            Removed
            <span>{removedCount}</span>
          </Link>
        </div>

        {events.length === 0 ? (
          <div className="empty-state">
            <h4>{getEmptyTitle(currentView)}</h4>
            <p>{getEmptyMessage(currentView)}</p>
          </div>
        ) : (
          <form action={handleBulkInventoryAction}>
            <input type="hidden" name="currentView" value={currentView} />

            <div className="bulk-action-bar">
              <div>
                <p className="bulk-action-title">Bulk actions</p>
                <p className="bulk-action-help">
                  {currentView === "removed"
                    ? "Restore selected rows, or permanently empty the removed list."
                    : "Select one or more rows, then choose an action."}
                </p>
              </div>

              <div className="bulk-action-buttons">
                {currentView !== "reviewed" && (
                  <button
                    type="submit"
                    name="bulkAction"
                    value="mark-reviewed"
                    className="bulk-action-button bulk-action-primary"
                  >
                    Mark selected reviewed
                  </button>
                )}

                {currentView !== "queue" && (
                  <button
                    type="submit"
                    name="bulkAction"
                    value="restore"
                    className="bulk-action-button bulk-action-secondary"
                  >
                    Restore to queue
                  </button>
                )}

                {currentView !== "removed" && (
                  <button
                    type="submit"
                    name="bulkAction"
                    value="remove"
                    className="bulk-action-button bulk-action-danger"
                  >
                    Remove selected
                  </button>
                )}

                {currentView === "removed" && (
                  <button
                    formAction={emptyRemovedInventoryEvents}
                    className="bulk-action-button bulk-action-danger"
                  >
                    Empty removed
                  </button>
                )}
              </div>
            </div>

            <div className="inventory-table-wrap">
              <table className="inventory-table">
                <thead>
                  <tr>
                    <th className="checkbox-column">
                      <span className="sr-only">Select</span>
                    </th>
                    <th>Detected</th>
                    <th>Product</th>
                    <th>Variant</th>
                    <th>SKU</th>
                    <th>Qty Change</th>
                    <th>Status</th>
                  </tr>
                </thead>

                <tbody>
                  {events.map((event) => (
                    <tr key={event.id}>
                      <td className="checkbox-column">
                        <input
                          type="checkbox"
                          name="eventIds"
                          value={event.id}
                          aria-label={`Select ${
                            event.productTitle || "inventory event"
                          }`}
                          className="inventory-row-checkbox"
                        />
                      </td>

                      <td>{formatDate(event.detectedAt)}</td>

                      <td className="inventory-product-cell">
                        <p className="inventory-product-title">
                          {event.productTitle || "Unknown product"}
                        </p>
                      </td>

                      <td>{event.variantTitle || "Default Title"}</td>

                      <td>
                        <span className="inventory-muted">
                          {event.sku || "—"}
                        </span>
                      </td>

                      <td>
                        <span className="qty-change-cell">
                          {event.startingAvailable} → {event.endingAvailable}
                          <span className="negative-delta">
                            {event.netDelta}
                          </span>
                        </span>
                      </td>

                      <td>
                        <span
                          className={`status-pill ${
                            event.reviewStatus === "Reviewed"
                              ? "status-reviewed"
                              : event.reviewStatus === "Removed"
                                ? "status-removed"
                                : "status-unreviewed"
                          }`}
                        >
                          {event.reviewStatus}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}