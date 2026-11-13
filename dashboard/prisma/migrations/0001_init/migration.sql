-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timestamp" TEXT NOT NULL,
    "scannedDirectory" TEXT NOT NULL,
    "overallDecision" TEXT NOT NULL,
    "overallScore" INTEGER NOT NULL,
    "privacyScore" INTEGER NOT NULL,
    "securityScore" INTEGER NOT NULL,
    "aiSafetyScore" INTEGER NOT NULL,
    "backdoorRiskScore" INTEGER NOT NULL,
    "confidenceScore" INTEGER NOT NULL,
    "totalFiles" INTEGER NOT NULL,
    "totalFindings" INTEGER NOT NULL,
    "criticalCount" INTEGER NOT NULL,
    "highCount" INTEGER NOT NULL,
    "mediumCount" INTEGER NOT NULL,
    "lowCount" INTEGER NOT NULL,
    "qualityCount" INTEGER NOT NULL DEFAULT 0,
    "securityCount" INTEGER NOT NULL DEFAULT 0,
    "privacyCount" INTEGER NOT NULL DEFAULT 0,
    "aiSafetyCount" INTEGER NOT NULL DEFAULT 0,
    "backdoorCount" INTEGER NOT NULL DEFAULT 0,
    "privacyDiffJson" TEXT,
    "source" TEXT NOT NULL DEFAULT 'cli',
    "repo" TEXT,
    "prNumber" INTEGER,
    "prTitle" TEXT,
    "prUrl" TEXT,
    "commitSha" TEXT,
    "prAuthor" TEXT,
    "ruleFlags" INTEGER,
    "aiDismissed" INTEGER,
    "aiFound" INTEGER,
    "aiUsed" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "file" TEXT NOT NULL,
    "line" INTEGER NOT NULL,
    "snippet" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL DEFAULT '',
    "ruleTriggered" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "whyItMatters" TEXT NOT NULL DEFAULT '',
    "llmReason" TEXT,
    "llmFix" TEXT,
    "llmIntent" TEXT,
    "source" TEXT NOT NULL DEFAULT 'rule',
    "reportId" TEXT NOT NULL,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Report_createdAt_idx" ON "Report"("createdAt");

-- CreateIndex
CREATE INDEX "Finding_reportId_idx" ON "Finding"("reportId");

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

