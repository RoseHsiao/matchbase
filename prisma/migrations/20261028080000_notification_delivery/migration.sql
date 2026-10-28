-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENDING', 'RETRY', 'SENT', 'SUPPRESSED', 'SKIPPED', 'FAILED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "reminderEmails" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reminder" "WatchlistReminder" NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL,
    "leaseUntil" TIMESTAMPTZ(3),
    "sentAt" TIMESTAMPTZ(3),
    "providerMessageId" TEXT,
    "lastErrorCategory" TEXT,
    "outcomeReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_matchId_idx" ON "NotificationDelivery"("matchId");

-- CreateIndex
CREATE INDEX "NotificationDelivery_sentAt_idx" ON "NotificationDelivery"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_userId_matchId_kind_dueAt_key" ON "NotificationDelivery"("userId", "matchId", "kind", "dueAt");

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

