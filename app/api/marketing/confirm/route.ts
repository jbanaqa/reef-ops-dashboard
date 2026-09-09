import { atomic, consent, record, shop } from "@/lib/marketing/store";
import { confirmationHash } from "@/lib/marketing/confirmation";
import { enroll } from "@/lib/marketing/flows";
export const dynamic = "force-dynamic";
const headers = {
  "Content-Type": "text/html",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};
export async function GET() {
  return new Response(
    '<html><body><h1>Confirm your email signup</h1><p>Confirm to receive Corals Anonymous marketing emails and your first-order offer.</p><form method="post"><button>Confirm email marketing signup</button></form></body></html>',
    { headers },
  );
}
export async function POST(request: Request) {
  try {
    const hash = confirmationHash(
      new URL(request.url).searchParams.get("token") || "",
    );
    await atomic(async (tx) => {
      const proof = await tx.marketingResource.findUnique({
        where: {
          shop_kind_key: { shop: shop(), kind: "CONFIRMATION", key: hash },
        },
      });
      const p = proof?.data as
        { session: string; email: string; expiresAt: string } | undefined;
      if (!p || new Date(p.expiresAt) <= new Date())
        throw new Error(
          "Invalid or expired confirmation link. Request a new signup email.",
        );
      const session = await tx.marketingResource.findUnique({
        where: {
          shop_kind_key: { shop: shop(), kind: "SIGNUP", key: p.session },
        },
      });
      const d = session?.data as
        | {
            profileId: string;
            expiresAt: string;
            confirmed: boolean;
            anonymousId?: string;
            version?: number;
          }
        | undefined;
      if (!d || d.version !== 2 || new Date(d.expiresAt) <= new Date())
        throw new Error("This confirmation link has expired.");
      const profile = await tx.marketingProfile.findUniqueOrThrow({
        where: { id: d.profileId },
        include: { consents: true },
      });
      if (
        profile.email !== p.email ||
        profile.consents.some((c) => c.channel === "EMAIL" && c.suppressed)
      )
        throw new Error("This signup can no longer be confirmed.");
      if (!d.confirmed) {
        await consent(
          tx,
          d.profileId,
          "EMAIL",
          "SUBSCRIBED",
          "storefront-confirmed-v2",
          new Date(),
        );
        await tx.marketingResource.update({
          where: { id: session!.id },
          data: { data: { ...d, confirmed: true } },
        });
        await record(tx, {
          key: "confirmed:" + p.session,
          type: "FORM_EMAIL_CONFIRMED",
          profileId: d.profileId,
        });
        if (d.anonymousId)
          await tx.marketingEvent.updateMany({
            where: {
              shop: shop(),
              anonymousId: d.anonymousId,
              profileId: null,
            },
            data: { profileId: d.profileId },
          });
        await enroll(tx, "welcome", d.profileId, p.session, new Date());
      }
      await tx.marketingResource.delete({ where: { id: proof!.id } });
    });
    return new Response(
      "Email confirmed. Return to the original store browser to continue signup.",
      {
        headers: {
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      },
    );
  } catch (e) {
    return new Response(
      e instanceof Error ? e.message : "Confirmation failed",
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      },
    );
  }
}
