import { NextResponse } from "next/server";
import { createProductRestockWaitlistSignup } from "@/lib/product-restock-waitlist";
import { prisma } from "@/lib/prisma";
import { getProductInventoryDetails } from "@/lib/shopify";

function getAllowedOrigin() {
  return process.env.RESTOCK_WAITLIST_ALLOWED_ORIGIN || "";
}

function getCorsHeaders(
  origin: string | null
): Record<string, string> {
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
  const contentType =
    request.headers.get("content-type") || "";

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

    /*
      This hidden field is a simple bot trap.
      Real customers leave it empty.
    */
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

    const shop = process.env.SHOPIFY_SHOP_DOMAIN;

    if (!shop) {
      throw new Error(
        "Shopify store configuration is missing."
      );
    }

    const submittedProductId = String(
      payload.productId ||
        payload.product_id ||
        ""
    ).trim();

    /*
      Shopify Liquid supplies the numeric legacy
      product ID. Reject arbitrary text and GIDs
      submitted directly to this public endpoint.
    */
    if (!/^\d+$/.test(submittedProductId)) {
      throw new Error("The product ID is invalid.");
    }

    /*
      Retrieve the authoritative product information
      from Shopify. Do not trust the title, handle,
      inventory, or shop submitted by the browser.
    */
    const product =
      await getProductInventoryDetails(
        submittedProductId
      );

    if (!product) {
      throw new Error(
        "This Shopify product could not be found."
      );
    }

    if (product.status !== "ACTIVE") {
      throw new Error(
        "This product is not currently active."
      );
    }

    /*
      Customers should only join this waitlist while
      the entire product is unavailable.
    */
    if (product.totalAvailable > 0) {
      throw new Error(
        "This product is already available."
      );
    }

    /*
      Remember the product's current unavailable state.
      A later Shopify webhook can compare this zero
      value with the new product-level total.
    */
    await prisma.productInventoryState.upsert({
      where: {
        shop_productId: {
          shop,
          productId: product.productId,
        },
      },
      create: {
        shop,
        productId: product.productId,
        productHandle: product.productHandle,
        productTitle: product.productTitle,
        totalAvailable: product.totalAvailable,
        checkedAt: new Date(),
      },
      update: {
        productHandle: product.productHandle,
        productTitle: product.productTitle,
        totalAvailable: product.totalAvailable,
        checkedAt: new Date(),
      },
    });

    const result =
      await createProductRestockWaitlistSignup({
        shop,
        productId: product.productId,
        productHandle: product.productHandle,
        productTitle: product.productTitle,
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