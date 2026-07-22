import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { manuallySendProductRestockWaitlistEntry } from "@/lib/product-restock-waitlist";
import { PrintableWaitlist } from "./printable-waitlist";

export const dynamic = "force-dynamic";

type RestockWaitlistPageProps = {
  searchParams?: Promise<{
    result?: string;
    message?: string;
  }>;
};

function formatDate(date: Date | null) {
  if (!date) {
    return "Not yet";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function getResultUrl(
  result: "success" | "error",
  message: string
) {
  const params = new URLSearchParams({
    result,
    message,
  });

  return `/restock-waitlist?${params.toString()}`;
}

async function sendWaitlistEmail(formData: FormData) {
  "use server";

  const entryId = String(
    formData.get("entryId") || ""
  );

  let result: "success" | "error" = "success";
  let message = "Restock email sent and status changed to Notified.";

  try {
    const sendResult =
      await manuallySendProductRestockWaitlistEntry(
        entryId
      );

    if (
      sendResult.action ===
      "manual_send_skipped_not_waiting"
    ) {
      result = "error";
      message =
        "This signup is no longer waiting, so no email was sent.";
    }
  } catch (error) {
    result = "error";
    message =
      error instanceof Error
        ? error.message
        : "The restock email could not be sent.";
  }

  revalidatePath("/restock-waitlist");
  redirect(getResultUrl(result, message));
}

async function deleteWaitlistEntry(formData: FormData) {
  "use server";

  const entryId = String(
    formData.get("entryId") || ""
  );

  let result: "success" | "error" = "success";
  let message = "Waitlist signup deleted.";

  try {
    if (!entryId) {
      throw new Error(
        "The waitlist signup could not be identified."
      );
    }

    const deletion =
      await prisma.productRestockWaitlist.deleteMany({
        where: {
          id: entryId,
        },
      });

    if (deletion.count === 0) {
      throw new Error(
        "This waitlist signup was already removed."
      );
    }
  } catch (error) {
    result = "error";
    message =
      error instanceof Error
        ? error.message
        : "The waitlist signup could not be deleted.";
  }

  revalidatePath("/restock-waitlist");
  redirect(getResultUrl(result, message));
}

export default async function RestockWaitlistPage({
  searchParams,
}: RestockWaitlistPageProps) {
  const resolvedSearchParams = await searchParams;

  const [
    totalCount,
    waitingCount,
    notifiedCount,
    unsubscribedCount,
    recent,
  ] = await Promise.all([
    prisma.productRestockWaitlist.count(),
    prisma.productRestockWaitlist.count({
      where: {
        status: "Waiting",
      },
    }),
    prisma.productRestockWaitlist.count({
      where: {
        status: "Notified",
      },
    }),
    prisma.productRestockWaitlist.count({
      where: {
        status: "Unsubscribed",
      },
    }),
    prisma.productRestockWaitlist.findMany({
      orderBy: {
        subscribedAt: "desc",
      },
      take: 50,
    }),
  ]);

  return (
    <div className="page-stack">
      <section>
        <p className="page-header-eyebrow">
          Product Demand
        </p>

        <h2 className="page-title">
          Restock Waitlist
        </h2>

        <p className="page-description">
          Product-level customer email alerts for out-of-stock Shopify products.
          Customers are notified when total product inventory becomes available
          again across any variant.
        </p>
      </section>

      {resolvedSearchParams?.message ? (
        <section className="card card-padded">
          <p
            className={
              resolvedSearchParams.result === "success"
                ? "success-message"
                : "error-message"
            }
          >
            {resolvedSearchParams.message}
          </p>
        </section>
      ) : null}

      <section className="stats-grid">
        <div className="card stat-card">
          <p className="stat-label">
            Total Signups
          </p>
          <p className="stat-value">
            {totalCount}
          </p>
          <p className="stat-description">
            All restock waitlist records.
          </p>
        </div>

        <div className="card stat-card">
          <p className="stat-label">
            Waiting
          </p>
          <p className="stat-value">
            {waitingCount}
          </p>
          <p className="stat-description">
            Customers still waiting for restock.
          </p>
        </div>

        <div className="card stat-card">
          <p className="stat-label">
            Notified
          </p>
          <p className="stat-value">
            {notifiedCount}
          </p>
          <p className="stat-description">
            Alerts sent after product restock.
          </p>
        </div>

        <div className="card stat-card">
          <p className="stat-label">
            Unsubscribed
          </p>
          <p className="stat-value">
            {unsubscribedCount}
          </p>
          <p className="stat-description">
            Customers who opted out.
          </p>
        </div>
      </section>

      <section className="card feedback-table-card">
        <div className="feedback-table-header">
          <div>
            <h3 className="card-title">
              Recent Signups
            </h3>
            <p className="card-description">
              Send a waiting customer’s email manually or delete test entries.
              Showing the latest 50 product-level waitlist entries.
            </p>
          </div>
        </div>

        {recent.length === 0 ? (
          <div className="empty-state">
            <h4 className="empty-state-title">
              No waitlist signups yet
            </h4>
            <p className="empty-state-text">
              Customer submissions from the Shopify product form will appear
              here.
            </p>
          </div>
        ) : (
          <PrintableWaitlist
            entries={recent.map((entry) => ({
              id: entry.id,
              productId: entry.productId,
              productHandle: entry.productHandle,
              productTitle: entry.productTitle,
              email: entry.email,
              status: entry.status,
              subscribedLabel: formatDate(entry.subscribedAt),
              notifiedLabel: formatDate(entry.notifiedAt),
            }))}
            sendAction={sendWaitlistEmail}
            deleteAction={deleteWaitlistEntry}
          />
        )}
      </section>
    </div>
  );
}
