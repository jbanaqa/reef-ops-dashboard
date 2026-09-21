async function main() {
  if (
    !process.env.SPECIES_LIBRARY_SHOP_DOMAIN ||
    !process.env.MACROALGAE_SHOPIFY_CLIENT_ID ||
    !process.env.MACROALGAE_SHOPIFY_CLIENT_SECRET
  ) {
    console.log("[sale-rotation] Macroalgae Shopify is not configured; skipping.");
    return;
  }

  const [{ runScheduledSaleRotation }, { prisma }] = await Promise.all([
    import("../lib/sale-rotation"),
    import("../lib/prisma"),
  ]);

  try {
    const result = await runScheduledSaleRotation();
    console.log(`[sale-rotation] ${JSON.stringify(result)}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[sale-rotation] Scheduled runner failed:", error);
  process.exitCode = 1;
});
