import OpenAI from "openai";
import { NextResponse } from "next/server";

const allowedSources = [
  "Google Review",
  "Reddit",
  "Reef2Reef",
  "Facebook",
  "Instagram",
  "Email",
  "Phone Call",
  "Internal Staff Note",
  "Other",
];

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Missing OPENAI_API_KEY environment variable.",
    );
  }

  return new OpenAI({
    apiKey,
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const source = String(body.source || "").trim();
    const sourceUrl = String(body.sourceUrl || "").trim();
    const customerReference = String(
      body.customerReference || "",
    ).trim();
    const feedbackText = String(
      body.feedbackText || "",
    ).trim();
    const staffNote = String(body.staffNote || "").trim();

    if (!feedbackText) {
      return NextResponse.json(
        {
          error: "Feedback text is required.",
        },
        {
          status: 400,
        },
      );
    }

    if (source && !allowedSources.includes(source)) {
      return NextResponse.json(
        {
          error: "Invalid feedback source.",
        },
        {
          status: 400,
        },
      );
    }

    const client = getOpenAIClient();

    const response = await client.responses.create({
      model: "gpt-5.2",

      instructions: `
You are an internal company feedback analyst for a reef livestock e-commerce company.

Your job is to turn messy feedback into structured operational intelligence.

Important rules:
- Do not assume facts that are not present.
- Do not decide that a customer is lying.
- If order/customer details are missing, mark the item as needing investigation.
- Be concise and practical.
- Return only valid JSON.
- The JSON must match the requested schema exactly.
      `,

      input: `
Analyze this feedback item.

Source: ${source || "Unknown"}
Source URL: ${sourceUrl || "Not provided"}
Customer / Order Reference: ${
        customerReference || "Not provided"
      }
Internal Staff Note: ${staffNote || "Not provided"}

Feedback Text:
${feedbackText}

Return JSON with this exact shape:
{
  "sentiment": "positive | neutral | mixed | negative",
  "issueTypes": ["DOA", "Shipping", "Customer Support", "Wrong Item", "Livestock Health", "Product Quality", "Policy Confusion", "Pricing", "Misinformation", "Praise", "Other"],
  "severity": "low | medium | high | urgent",
  "validityEstimate": "likely_valid | unclear | possibly_inaccurate | not_actionable | needs_investigation",
  "suggestedStatus": "New | Needs Investigation | Needs Response | Internal Issue | No Action",
  "confidence": 0.0,
  "summary": "1-2 sentence summary.",
  "suggestedNextAction": "Concrete next step for staff.",
  "suggestedResponse": "A calm staff-reviewable response draft, or an empty string if no response is needed.",
  "missingInformation": ["order number", "customer email"]
}
      `,
    });

    const rawText = response.output_text;

    let analysis: unknown;

    try {
      analysis = JSON.parse(rawText);
    } catch {
      return NextResponse.json(
        {
          error: "AI returned invalid JSON.",
          rawText,
        },
        {
          status: 500,
        },
      );
    }

    return NextResponse.json({
      analysis,
    });
  } catch (error) {
    console.error("Feedback analysis error:", error);

    if (
      error instanceof Error &&
      error.message.includes("OPENAI_API_KEY")
    ) {
      return NextResponse.json(
        {
          error:
            "Feedback analysis is not configured because OPENAI_API_KEY is missing.",
        },
        {
          status: 503,
        },
      );
    }

    return NextResponse.json(
      {
        error: "Failed to analyze feedback.",
      },
      {
        status: 500,
      },
    );
  }
}