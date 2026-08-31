import { macroalgaeGraphql } from "./macroalgae-shopify";

const TOPICS = ["PRODUCTS_CREATE", "PRODUCTS_UPDATE"] as const;

type ListResponse = { data?: { webhookSubscriptions: { nodes: Array<{ id: string; topic: string; uri: string }> } } };
type CreateResponse = { data?: { webhookSubscriptionCreate: {
  webhookSubscription: { id: string; topic: string; uri: string } | null;
  userErrors: Array<{ field: string[] | null; message: string }>;
} } };

const LIST = `query SpeciesWebhooks { webhookSubscriptions(first: 100) { nodes { id topic uri } } }`;
const CREATE = `
  mutation CreateSpeciesWebhook($topic: WebhookSubscriptionTopic!, $input: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $input) {
      webhookSubscription { id topic uri }
      userErrors { field message }
    }
  }
`;

export async function registerSpeciesWebhooks(appBaseUrl: string) {
  const baseUrl = new URL(appBaseUrl);
  if (baseUrl.protocol !== "https:") throw new Error("Species webhook base URL must use HTTPS.");
  baseUrl.pathname = "/api/webhooks/shopify/species-products";
  baseUrl.search = ""; baseUrl.hash = "";
  const uri = baseUrl.toString();
  const existing = await macroalgaeGraphql<ListResponse>(LIST);
  const subscriptions = existing.data?.webhookSubscriptions.nodes || [];
  const results: Array<Record<string, unknown>> = [];

  for (const topic of TOPICS) {
    const found = subscriptions.find((subscription) => subscription.topic === topic && subscription.uri === uri);
    if (found) { results.push({ topic, action: "already_registered", id: found.id, uri }); continue; }
    const response = await macroalgaeGraphql<CreateResponse>(CREATE, { topic, input: { uri, format: "JSON" } });
    const payload = response.data?.webhookSubscriptionCreate;
    if (!payload || payload.userErrors.length || !payload.webhookSubscription) {
      throw new Error(`Failed to register ${topic}: ${payload?.userErrors.map((error) => error.message).join("; ") || "unknown error"}`);
    }
    results.push({ action: "registered", ...payload.webhookSubscription });
  }
  return results;
}
