import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
async function main() {
  if (process.argv.slice(2).some((v) => v !== "--apply")) throw new Error("Use optional --apply; no other audiences are supported.");
  const { prisma } = await import("../lib/prisma");
  try {
    const { fetchMailableSource, alignMailableSource } = await import("../lib/marketing/mailable-alignment");
    console.log("Reading only Klaviyo's 2025 Mailable Subscribers segment. No emails will be sent.");
    const source = await fetchMailableSource();
    console.log(JSON.stringify(await alignMailableSource(source)));
    if (process.argv.includes("--apply")) console.log(JSON.stringify(await alignMailableSource(source, true)));
  } finally { await prisma.$disconnect(); }
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
