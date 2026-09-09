// Generate and verify with disposable configuration. No deployment database is used.
const { spawnSync } = require("node:child_process");
const mode = process.argv[2];
if (!["test", "build"].includes(mode)) throw new Error("Use test or build.");
process.env.DATABASE_URL = "postgresql://verify:verify@127.0.0.1:1/verify";
process.env.SHOPIFY_SHOP_DOMAIN = "verify.myshopify.com";
function run(args) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
run([require.resolve("prisma/build/index.js"), "generate"]);
if (mode === "build") {
  run([require.resolve("next/dist/bin/next"), "build"]);
} else {
  run(["node_modules/tsx/dist/cli.mjs", "--tsconfig", "scripts/tsconfig.marketing-tests.json", "--test", "--test-timeout=60000", "scripts/marketing.test.ts", "scripts/marketing.editor.test.tsx", "scripts/marketing.integration.test.ts"]);
}
