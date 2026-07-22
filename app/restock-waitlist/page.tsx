import Link from "next/link";
import type { Prisma } from "@/app/generated/prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { manuallySendProductRestockWaitlistEntry } from "@/lib/product-restock-waitlist";
import { RestockWaitlistWorkspace } from "./restock-waitlist-workspace";
import styles from "./restock-waitlist.module.css";

export const dynamic = "force-dynamic";

const PAGE_SIZES = [25, 50, 100] as const;
const FILTERS = ["waiting", "notified", "handled", "canceled", "all"] as const;
const SORTS = ["subscribedAt", "productTitle", "email", "status", "notifiedAt"] as const;

type Filter = (typeof FILTERS)[number];
type Sort = (typeof SORTS)[number];
type SearchParams = { result?:string; message?:string; filter?:string; q?:string; sort?:string; dir?:string; page?:string; pageSize?:string };
type PageProps = { searchParams?: Promise<SearchParams> };

function oneOf<T extends readonly string[]>(value:string|undefined, values:T, fallback:T[number]):T[number] {
  return values.includes(value as T[number]) ? value as T[number] : fallback;
}

function positiveInt(value:string|undefined, fallback:number) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function statusWhere(filter:Filter):Prisma.ProductRestockWaitlistWhereInput {
  if (filter === "all") return {};
  if (filter === "canceled") return { status: "Unsubscribed" };
  return { status: filter[0].toUpperCase() + filter.slice(1) };
}

function safeReturnTo(value:FormDataEntryValue|null) {
  const path = String(value || "/restock-waitlist");
  return path.startsWith("/restock-waitlist") && !path.startsWith("//") ? path : "/restock-waitlist";
}

function resultUrl(returnTo:string, result:"success"|"error", message:string) {
  const url = new URL(returnTo, "https://reef-ops.local");
  url.searchParams.set("result", result);
  url.searchParams.set("message", message);
  return `${url.pathname}?${url.searchParams.toString()}`;
}

async function sendWaitlistEmail(formData:FormData) {
  "use server";
  const id = String(formData.get("entryId") || "");
  const returnTo = safeReturnTo(formData.get("returnTo"));
  let result:"success"|"error" = "success";
  let message = "Restock email sent. The request is now Notified.";
  try {
    const response = await manuallySendProductRestockWaitlistEntry(id);
    if (response.action === "manual_send_skipped_not_waiting") throw new Error("This request is no longer waiting, so no email was sent.");
  } catch (error) {
    result = "error";
    message = error instanceof Error ? error.message : "The restock email could not be sent.";
  }
  revalidatePath("/restock-waitlist");
  redirect(resultUrl(returnTo, result, message));
}

async function markHandled(formData:FormData) {
  "use server";
  const ids = String(formData.get("entryIds") || formData.get("entryId") || "").split(",").map((id) => id.trim()).filter(Boolean).slice(0, 100);
  const returnTo = safeReturnTo(formData.get("returnTo"));
  let result:"success"|"error" = "success";
  let message = "Request marked Handled. It will no longer receive an automatic restock email.";
  try {
    if (!ids.length) throw new Error("Select at least one waiting request.");
    const update = await prisma.productRestockWaitlist.updateMany({ where:{ id:{ in:ids }, status:"Waiting" }, data:{ status:"Handled" } });
    if (!update.count) throw new Error("The selected requests were already completed or removed.");
    message = `${update.count} ${update.count === 1 ? "request" : "requests"} marked Handled.`;
  } catch (error) {
    result = "error";
    message = error instanceof Error ? error.message : "The selected requests could not be updated.";
  }
  revalidatePath("/restock-waitlist");
  redirect(resultUrl(returnTo, result, message));
}

async function deleteWaitlistEntry(formData:FormData) {
  "use server";
  const id = String(formData.get("entryId") || "");
  const returnTo = safeReturnTo(formData.get("returnTo"));
  let result:"success"|"error" = "success";
  let message = "Waitlist record permanently deleted.";
  try {
    const deletion = await prisma.productRestockWaitlist.deleteMany({ where:{ id } });
    if (!deletion.count) throw new Error("This waitlist record was already removed.");
  } catch (error) {
    result = "error";
    message = error instanceof Error ? error.message : "The waitlist record could not be deleted.";
  }
  revalidatePath("/restock-waitlist");
  redirect(resultUrl(returnTo, result, message));
}

function hrefFor(current:SearchParams, updates:Record<string,string|number|undefined>) {
  const params = new URLSearchParams();
  for (const [key,value] of Object.entries({ ...current, ...updates })) {
    if (value !== undefined && value !== "" && key !== "message" && key !== "result") params.set(key,String(value));
  }
  return `/restock-waitlist${params.size ? `?${params}` : ""}`;
}

export default async function RestockWaitlistPage({ searchParams }:PageProps) {
  const raw = await searchParams || {};
  const filter = oneOf(raw.filter, FILTERS, "waiting") as Filter;
  const sort = oneOf(raw.sort, SORTS, "subscribedAt") as Sort;
  const dir = raw.dir === "asc" ? "asc" : "desc";
  const pageSize = PAGE_SIZES.includes(Number(raw.pageSize) as typeof PAGE_SIZES[number]) ? Number(raw.pageSize) : 25;
  const requestedPage = positiveInt(raw.page, 1);
  const query = String(raw.q || "").trim().slice(0, 120);
  const where:Prisma.ProductRestockWaitlistWhereInput = {
    ...statusWhere(filter),
    ...(query ? { OR:[
      { productTitle:{ contains:query, mode:"insensitive" } },
      { productHandle:{ contains:query, mode:"insensitive" } },
      { email:{ contains:query, mode:"insensitive" } },
    ] } : {}),
  };

  const [totalCount, waitingCount, notifiedCount, handledCount, canceledCount, filteredCount] = await Promise.all([
    prisma.productRestockWaitlist.count(),
    prisma.productRestockWaitlist.count({ where:{ status:"Waiting" } }),
    prisma.productRestockWaitlist.count({ where:{ status:"Notified" } }),
    prisma.productRestockWaitlist.count({ where:{ status:"Handled" } }),
    prisma.productRestockWaitlist.count({ where:{ status:"Unsubscribed" } }),
    prisma.productRestockWaitlist.count({ where }),
  ]);
  const pageCount = Math.max(1, Math.ceil(filteredCount / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const entries = await prisma.productRestockWaitlist.findMany({
    where,
    orderBy: sort === "notifiedAt" ? [{ notifiedAt:dir },{ subscribedAt:"desc" }] : [{ [sort]:dir },{ subscribedAt:"desc" }],
    skip:(page - 1) * pageSize,
    take:pageSize,
  });
  const currentParams:SearchParams = { filter, q:query || undefined, sort, dir, page:String(page), pageSize:String(pageSize) };

  const cards = [
    { key:"waiting", label:"Waiting", value:waitingCount, note:"Needs attention", tone:"mint", icon:"◷" },
    { key:"notified", label:"Notified", value:notifiedCount, note:"Restock emails sent", tone:"blue", icon:"✓" },
    { key:"handled", label:"Handled", value:handledCount, note:"Completed manually", tone:"gold", icon:"◇" },
    { key:"canceled", label:"Canceled", value:canceledCount, note:"Customer opted out", tone:"slate", icon:"×" },
  ] as const;

  return <div className={styles.page}>
    <section className={styles.hero}>
      <div className={styles.heroGlow}/><div className={styles.heroGrid}/>
      <div className={styles.heroCopy}>
        <p className={styles.eyebrow}><span/> Customer demand command center</p>
        <h1>Restock <em>Waitlist</em></h1>
        <p>Find the customers who need attention, send precise restock updates, and hand off a clean follow-up sheet without losing the history behind it.</p>
        <div className={styles.heroMeta}><span><i/> Live queue</span><span>{totalCount} lifetime signups</span><span>Pacific Time</span></div>
      </div>
      <div className={styles.orbit} aria-hidden="true"><div className={styles.orbitOuter}/><div className={styles.orbitInner}/><div className={styles.orbitCore}><strong>{waitingCount}</strong><span>waiting now</span></div><i/><i/></div>
    </section>

    <section className={styles.metricGrid} aria-label="Waitlist summary">
      {cards.map((card) => <Link key={card.key} href={hrefFor(currentParams,{ filter:card.key, page:1 })} className={`${styles.metricCard} ${styles[card.tone]} ${filter === card.key ? styles.metricActive : ""}`}>
        <div><span className={styles.metricIcon}>{card.icon}</span><span className={styles.metricLabel}>{card.label}</span></div>
        <strong>{card.value}</strong><p>{card.note}</p>
      </Link>)}
    </section>

    <RestockWaitlistWorkspace
      entries={entries.map((entry) => ({ ...entry, subscribedAt:entry.subscribedAt.toISOString(), notifiedAt:entry.notifiedAt?.toISOString() || null }))}
      counts={{ all:totalCount, waiting:waitingCount, notified:notifiedCount, handled:handledCount, canceled:canceledCount }}
      state={{ filter, query, sort, dir, page, pageSize, pageCount, filteredCount }}
      message={raw.message ? { type:raw.result === "success" ? "success" : "error", text:raw.message } : null}
      sendAction={sendWaitlistEmail}
      handledAction={markHandled}
      deleteAction={deleteWaitlistEntry}
    />
  </div>;
}
