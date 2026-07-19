import { NextResponse } from "next/server";
import { createProductRestockWaitlistSignup } from "@/lib/product-restock-waitlist";

function getAllowedOrigin() {
  return process.env.RESTOCK_WAITLIST_ALLOWED_ORIGIN || "";
}

function getCorsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigin = getAllowedOrigin();

  if (!allowedOrigin || origin !== allowedOrigin) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function isAllowedOrigin(origin: string | null) {
  const allowedOrigin = getAllowedOrigin();

  if (!allowedOrigin) {
    return true;
  }

  return origin === allowedOrigin;
}

async function readSignupPayload(request: Request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return request.json();
  }

  const formData = await request.formData();

  return Object.fromEntries(formData.entries());
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");

  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const headers = getCorsHeaders(origin);

  if (!isAllowedOrigin(origin)) {
    return NextResponse.json(
      {
        error: "Origin is not allowed.",
      },
      {
        status: 403,
        headers,
      }
    );
  }

  try {
    const payload = await readSignupPayload(request);

    if (String(payload.company || "").trim()) {
      return NextResponse.json(
        {
          ok: true,
        },
        {
          headers,
        }
      );
    }

    const result = await createProductRestockWaitlistSignup({
      shop: String(process.env.SHOPIFY_SHOP_DOMAIN || ""),
      productId: String(payload.productId || payload.product_id || ""),
      productHandle: String(payload.productHandle || payload.product_handle || ""),
      productTitle: String(payload.productTitle || payload.product_title || ""),
      email: String(payload.email || ""),
    });

    return NextResponse.json(
      {
        ok: true,
        created: result.created,
      },
      {
        headers,
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not join the restock waitlist.",
      },
      {
        status: 400,
        headers,
      }
    );
  }
}
