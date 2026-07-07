-- CreateTable
CREATE TABLE "FeedbackItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "customerReference" TEXT,
    "feedbackText" TEXT NOT NULL,
    "staffNote" TEXT,
    "aiSentiment" TEXT NOT NULL,
    "aiIssueTypes" TEXT NOT NULL,
    "aiSeverity" TEXT NOT NULL,
    "aiValidityEstimate" TEXT NOT NULL,
    "aiSuggestedStatus" TEXT NOT NULL,
    "aiConfidence" REAL NOT NULL,
    "aiSummary" TEXT NOT NULL,
    "aiSuggestedNextAction" TEXT NOT NULL,
    "aiSuggestedResponse" TEXT,
    "aiMissingInformation" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'New',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
