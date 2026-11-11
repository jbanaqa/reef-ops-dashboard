/** The Admin operation did not execute; retrying it cannot duplicate its mutation. */
export class ShopifyRequestNotExecutedError extends Error {
  constructor(error: unknown) {
    super(error instanceof Error ? error.message : "Shopify request preparation failed.", { cause: error });
    this.name = "ShopifyRequestNotExecutedError";
  }
}

/** Shopify rejects these request-cost errors before execution, never partial field errors. */
export function shopifyCostRejectedBeforeExecution(body: Record<string, unknown>): boolean {
  if (body.data != null || !Array.isArray(body.errors) || !body.errors.length) return false;
  return body.errors.every(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const error = value as { path?: unknown; extensions?: { code?: unknown } };
    const code = error.extensions?.code;
    return error.path == null && typeof code === "string" && ["THROTTLED", "MAX_COST_EXCEEDED"].includes(code);
  });
}
