-- CreateEnum
CREATE TYPE "MatchSide" AS ENUM ('A', 'B');

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "sideAScore" INTEGER,
ADD COLUMN     "sideBScore" INTEGER,
ALTER COLUMN "homeTeamId" DROP NOT NULL,
ALTER COLUMN "awayTeamId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "MatchParticipant" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "side" "MatchSide" NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 1,
    "teamId" TEXT,
    "playerId" TEXT,

    CONSTRAINT "MatchParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MatchParticipant_matchId_idx" ON "MatchParticipant"("matchId");

-- CreateIndex
CREATE INDEX "MatchParticipant_teamId_idx" ON "MatchParticipant"("teamId");

-- CreateIndex
CREATE INDEX "MatchParticipant_playerId_idx" ON "MatchParticipant"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchParticipant_matchId_side_order_key" ON "MatchParticipant"("matchId", "side", "order");

-- CreateIndex
CREATE UNIQUE INDEX "MatchParticipant_matchId_teamId_key" ON "MatchParticipant"("matchId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchParticipant_matchId_playerId_key" ON "MatchParticipant"("matchId", "playerId");

-- AddForeignKey
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: every existing match becomes two team participants (side A = former home, side B = former away),
-- and the legacy scores are copied to the side scores. Ids are generated here; nothing references them yet.
INSERT INTO "MatchParticipant" ("id", "matchId", "side", "order", "teamId")
SELECT 'mp_' || md5(m."id" || ':A:1'), m."id", 'A'::"MatchSide", 1, m."homeTeamId" FROM "Match" m WHERE m."homeTeamId" IS NOT NULL
UNION ALL
SELECT 'mp_' || md5(m."id" || ':B:1'), m."id", 'B'::"MatchSide", 1, m."awayTeamId" FROM "Match" m WHERE m."awayTeamId" IS NOT NULL;

UPDATE "Match" SET "sideAScore" = "homeScore", "sideBScore" = "awayScore";

-- Invariants Prisma cannot express (decisions notes): paired aggregate scores, exactly one reference per
-- participant, positive positions.
ALTER TABLE "Match" ADD CONSTRAINT "Match_scores_paired" CHECK (("sideAScore" IS NULL) = ("sideBScore" IS NULL));
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_one_ref" CHECK (("teamId" IS NULL) <> ("playerId" IS NULL));
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_order_positive" CHECK ("order" >= 1);
