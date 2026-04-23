-- CreateTable
CREATE TABLE "IntradayBar" (
    "id" TEXT NOT NULL,
    "pairId" TEXT NOT NULL,
    "datetime" TIMESTAMP(3) NOT NULL,
    "timeframe" TEXT NOT NULL,
    "open" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "close" DOUBLE PRECISION NOT NULL,
    "volume" DOUBLE PRECISION,

    CONSTRAINT "IntradayBar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntradayBar_pairId_timeframe_datetime_idx" ON "IntradayBar"("pairId", "timeframe", "datetime");

-- CreateIndex
CREATE UNIQUE INDEX "IntradayBar_pairId_datetime_timeframe_key" ON "IntradayBar"("pairId", "datetime", "timeframe");

-- AddForeignKey
ALTER TABLE "IntradayBar" ADD CONSTRAINT "IntradayBar_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "Pair"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
