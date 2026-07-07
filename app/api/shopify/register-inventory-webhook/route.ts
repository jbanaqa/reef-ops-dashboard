import { NextResponse } from "next/server";
import { shopifyGraphql } from "@/lib/shopify";

type RegisterWebhookResponse = {
  data?: {
    webhookSubscriptionCreate?: {
      webhookSubscription?: {
        id: string;
        topic: string;
        uri: string;
      } | null;
      userErrors: {
        field: string[] | null;
        message: string;
      }[];
    };
  };
};

const WEBHOOK_MUTATION = `
  mutation RegisterInventoryWebhook(
    $topic: WebhookSubscriptionTopic!
    $webhookSubscription: WebhookSubscriptionInput!
  ) {
    webhookSubscriptionCreate(
      topic: $topic
      webhookSubscription: $webhookSubscription
    ) {
      webhookSubscription {
        id
        topic
        uri
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const callbackUrl = String(body.callbackUrl || "");

    if (!callbackUrl || !callbackUrl.startsWith("https://")) {
      return NextResponse.json(
        {
          error: "Missing valid callbackUrl. It must be an https:// URL.",
        },
        { status: 400 }
      );
    }

    const response = await shopifyGraphql<RegisterWebhookResponse>(
      WEBHOOK_MUTATION,
      {
        topic: "INVENTORY_LEVELS_UPDATE",
        webhookSubscription: {
          uri: callbackUrl,
          format: "JSON",
        },
      }
    );

    const result = response.data?.webhookSubscriptionCreate;

    if (!result) {
      return NextResponse.json(
        {
          error: "Shopify did not return webhookSubscriptionCreate result.",
          response,
        },
        { status: 500 }
      );
    }

    if (result.userErrors.length > 0) {
      return NextResponse.json(
        {
          error: "Shopify returned user errors.",
          userErrors: result.userErrors,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      webhookSubscription: result.webhookSubscription,
    });
  } catch (error) {
    console.error("Register inventory webhook error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to register inventory webhook.",
      },
      { status: 500 }
    );
  }
}