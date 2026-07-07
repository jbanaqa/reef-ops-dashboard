import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
type SaveFeedbackBody = {
  source?: string;
  sourceUrl?: string;
  customerReference?: string;
  feedbackText?: string;
  staffNote?: string;
  analysis?: {
    sentiment?: string;
    issueTypes?: string[];
    severity?: string;
    validityEstimate?: string;
    suggestedStatus?: string;
    confidence?: number;
    summary?: string;
    suggestedNextAction?: string;
    suggestedResponse?: string;
    missingInformation?: string[];
  };
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SaveFeedbackBody;

    const source = String(body.source || "").trim();
    const sourceUrl = String(body.sourceUrl || "").trim();
    const customerReference = String(body.customerReference || "").trim();
    const feedbackText = String(body.feedbackText || "").trim();
    const staffNote = String(body.staffNote || "").trim();
    const analysis = body.analysis;

    if (!source) {
      return NextResponse.json(
        { error: "Source is required." },
        { status: 400 }
      );
    }

    if (!feedbackText) {
      return NextResponse.json(
        { error: "Feedback text is required." },
        { status: 400 }
      );
    }

    if (!analysis) {
      return NextResponse.json(
        { error: "AI analysis is required before saving." },
        { status: 400 }
      );
    }

    const savedFeedback = await prisma.feedbackItem.create({
      data: {
        source,
        sourceUrl: sourceUrl || null,
        customerReference: customerReference || null,
        feedbackText,
        staffNote: staffNote || null,

        aiSentiment: analysis.sentiment || "unknown",
        aiIssueTypes: JSON.stringify(analysis.issueTypes || []),
        aiSeverity: analysis.severity || "unknown",
        aiValidityEstimate: analysis.validityEstimate || "unknown",
        aiSuggestedStatus: analysis.suggestedStatus || "New",
        aiConfidence:
          typeof analysis.confidence === "number" ? analysis.confidence : 0,
        aiSummary: analysis.summary || "",
        aiSuggestedNextAction: analysis.suggestedNextAction || "",
        aiSuggestedResponse: analysis.suggestedResponse || null,
        aiMissingInformation: JSON.stringify(
          analysis.missingInformation || []
        ),

        status: analysis.suggestedStatus || "New",
      },
    });

    return NextResponse.json({ feedback: savedFeedback }, { status: 201 });
  } catch (error) {
    console.error("Save feedback error:", error);

    return NextResponse.json(
      { error: "Failed to save feedback." },
      { status: 500 }
    );
  }
}