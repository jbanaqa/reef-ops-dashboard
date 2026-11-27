import { renderBlackFridayBadgedPhoto } from "@/lib/marketing/black-friday-badged-photo";
import { blackFridayShopifyPhoto } from "@/lib/marketing/black-friday-badged-photo-url";

export const runtime = "nodejs";

const photoLimit = 4 * 1024 * 1024;
const photoType = /^image\/(?:avif|gif|jpe?g|png|webp)(?:;|$)/i;

async function readPhoto(response: Response) {
  const length = Number(response.headers.get("Content-Length"));
  if (!response.ok || !photoType.test(response.headers.get("Content-Type") || "") || length > photoLimit || !response.body) {
    await response.body?.cancel();
    throw new Error("Product image is unavailable");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks, size);
    size += value.byteLength;
    if (size > photoLimit) {
      await reader.cancel();
      throw new Error("Product image is too large");
    }
    chunks.push(value);
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const image = blackFridayShopifyPhoto(params.get("image") || "");
  const discount = params.get("discount") || "";
  if (!image || !/^(?:[1-9][0-9]?|100)$/.test(discount))
    return new Response(null, { status: 400, headers: { "Cache-Control": "no-store" } });

  image.searchParams.set("width", "640");
  try {
    const photo = await readPhoto(await fetch(image, { redirect: "error", signal: AbortSignal.timeout(5000) }));
    const bytes = await renderBlackFridayBadgedPhoto(photo, Number(discount));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    // A temporary thumbnail failure can still display the original product photo.
    return new Response(null, {
      status: 307,
      headers: { Location: image.href, "Cache-Control": "no-store" },
    });
  }
}
