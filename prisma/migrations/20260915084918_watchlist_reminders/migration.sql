-- CreateEnum
CREATE TYPE "WatchlistReminder" AS ENUM ('OFF', 'AT_START', 'MIN_5', 'MIN_15', 'MIN_30', 'HOUR_1', 'DAY_1');

-- AlterTable
ALTER TABLE "UserWatchlistMatch" ADD COLUMN     "reminder" "WatchlistReminder" NOT NULL DEFAULT 'OFF';
