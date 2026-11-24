import { readFile } from "node:fs/promises";
import { join } from "node:path";

const mediaTypes = {
  "hero-v1.jpg": "image/jpeg",
  "closing-v1.jpg": "image/jpeg",
  "barlow-normal-400-v1.woff2": "font/woff2",
  "barlow-normal-600-v1.woff2": "font/woff2",
  "barlow-normal-700-v1.woff2": "font/woff2",
  "barlow-normal-800-v1.woff2": "font/woff2",
  "barlow-italic-800-v1.woff2": "font/woff2",
  "barlow-italic-900-v1.woff2": "font/woff2",
} as const;

// These immutable public files also work when the dashboard requires login.
export async function GET(_request: Request, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params;
  if (!Object.hasOwn(mediaTypes, file)) return new Response(null, { status: 404 });
  const bytes = await readFile(join(process.cwd(), "public", "reef-black-friday", file));
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mediaTypes[file as keyof typeof mediaTypes],
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
