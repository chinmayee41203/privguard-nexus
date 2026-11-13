-- Push-mode reviews: what triggered the review, and the branch pushed to
ALTER TABLE "Report" ADD COLUMN "trigger" TEXT;
ALTER TABLE "Report" ADD COLUMN "branch" TEXT;
