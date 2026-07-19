import { NextResponse } from "next/server";
import { Resend } from "resend";

export const runtime = "nodejs";

export async function GET() {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !fromEmail) {
    return NextResponse.json(
      {
        success: false,
        error: "Missing RESEND_API_KEY or RESEND_FROM_EMAIL.",
      },
      { status: 500 }
    );
  }

  const resend = new Resend(apiKey);

  const { data, error } = await resend.emails.send({
    from: fromEmail,
    to: "YOUR_EMAIL_HERE",
    subject: "Reef Ops Resend test",
    html: `
      <h2>Reef Ops email test</h2>
      <p>If you received this, Railway and Resend are connected correctly.</p>
    `,
  });

  if (error) {
    console.error("Resend error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    emailId: data?.id,
  });
}