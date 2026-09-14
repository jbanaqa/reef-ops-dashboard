import { atomic, consent, record, shop } from "@/lib/marketing/store";
import {
  canConfirmEmailResubscription,
  confirmationHash,
} from "@/lib/marketing/confirmation";
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
            purpose?: string;
            timezone?: string;
          }
        | undefined;
      if (!d || d.version !== 2 || new Date(d.expiresAt) <= new Date())
        throw new Error("This confirmation link has expired.");
      const profile = await tx.marketingProfile.findUniqueOrThrow({
        where: { id: d.profileId },
        include: { consents: true },
      });
      const emailConsent = profile.consents.find(
        (consent) => consent.channel === "EMAIL",
      );
      const resubscribe = d.purpose === "resubscribe";
      if (
        profile.email !== p.email ||
        (resubscribe
          ? !canConfirmEmailResubscription(emailConsent)
          : emailConsent?.suppressed)
      )
        throw new Error("This signup can no longer be confirmed.");
      if (!d.confirmed) {
        const confirmedAt = new Date();
        if (resubscribe) {
          await record(tx, {
            key: `consent:${d.profileId}:EMAIL:storefront-resubscribe-confirmed-v1:${confirmedAt.toISOString()}:SUBSCRIBED`,
            type: "CONSENT",
            profileId: d.profileId,
            occurredAt: confirmedAt,
            payload: {
              channel: "EMAIL",
              status: "SUBSCRIBED",
              source: "storefront-resubscribe-confirmed-v1",
              resubscription: true,
            },
          });
          await tx.marketingConsent.update({
            where: {
              profileId_channel: {
                profileId: d.profileId,
                channel: "EMAIL",
              },
            },
            data: {
              status: "SUBSCRIBED",
              suppressed: false,
              reason: null,
              source: "storefront-resubscribe-confirmed-v1",
              occurredAt: confirmedAt,
            },
          });
          await tx.marketingProfile.update({
            where: { id: d.profileId },
            data: {
              lists: [...new Set([...profile.lists, "Mailable Subscribers"])],
              ...(d.timezone
                ? {
                    properties: {
                      ...(profile.properties as object),
                      timezone: d.timezone,
                    },
                  }
                : {}),
            },
          });
        } else {
          await consent(
            tx,
            d.profileId,
            "EMAIL",
            "SUBSCRIBED",
            "storefront-confirmed-v2",
            confirmedAt,
          );
        }
        await tx.marketingResource.update({
          where: { id: session!.id },
          data: { data: { ...d, confirmed: true } },
        });
        await record(tx, {
          key: "confirmed:" + p.session,
          type: resubscribe
            ? "FORM_EMAIL_RESUBSCRIBED"
            : "FORM_EMAIL_CONFIRMED",
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
