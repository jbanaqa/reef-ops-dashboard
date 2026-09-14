const DEFAULT_WORKER_ORIGIN = "https://shipment-processor.jadenbanawa.workers.dev";

const exactRoutes = new Set([
  "status",
  "debug",
  "process",
  "process-shipment",
  "process-sales-report",
  "confirm-mapping",
  "restock",
  "search-products",
  "current-stock",
  "sales-demand",
  "mappings",
  "mapping",
  "shipments",
]);

function allowedPath(parts: string[]) {
  return parts.length === 1
    ? exactRoutes.has(parts[0])
    : parts.length === 2 && parts[0] === "shipments" && Boolean(parts[1]);
}

async function forward(request: Request, context: RouteContext<"/shipment-processor/api/[...path]">) {
  const { path } = await context.params;
  if (!allowedPath(path)) return Response.json({ error: "Not found" }, { status: 404 });

  const origin = process.env.SHIPMENT_PROCESSOR_ORIGIN || DEFAULT_WORKER_ORIGIN;
  let upstream: URL;
  try {
    upstream = new URL(`/api/${path.map(encodeURIComponent).join("/")}`, origin);
  } catch {
    return Response.json({ error: "Shipment processor URL is not configured correctly." }, { status: 503 });
  }
  const source = new URL(request.url);
  upstream.search = source.search;

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("accept", "application/json");

  try {
    const response = await fetch(upstream, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      cache: "no-store",
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const body = await response.arrayBuffer();
    return new Response(body, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") || "application/json" },
    });
  } catch {
    return Response.json({ error: "The shipment processor is unavailable. Try again shortly." }, { status: 502 });
  }
}

export const dynamic = "force-dynamic";
export const GET = forward;
export const POST = forward;
export const DELETE = forward;
