const cdn = "https://cdn.shopify.com";
const storePhoto = /^\/s\/files\/1\/0443\/0689\/0912\/(?:files|products)\/(?:preview_images\/)?[^/\\]+\.(?:avif|gif|jpe?g|png|webp)$/i;

export function blackFridayShopifyPhoto(source: string) {
  if (!source || source.length > 500) return;
  try {
    const url = new URL(source);
    if (url.origin !== cdn || url.username || url.password || !storePhoto.test(decodeURIComponent(url.pathname))) return;
    const image = new URL(url.pathname, cdn);
    const version = url.searchParams.get("v");
    if (version && /^\d{1,20}$/.test(version)) image.searchParams.set("v", version);
    return image;
  } catch {
    return;
  }
}

export function blackFridayBadgedPhotoUrl(base: string, source: string, discount: number) {
  const image = blackFridayShopifyPhoto(source);
  if (!image) return "";
  const params = new URLSearchParams({ image: image.href, discount: String(discount) });
  return base + "/api/marketing/black-friday-deal-photo?" + params;
}
