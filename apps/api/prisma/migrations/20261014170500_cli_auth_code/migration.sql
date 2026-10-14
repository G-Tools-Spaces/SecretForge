-- CreateTable
CREATE TABLE "CliAuthCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CliAuthCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CliAuthCode_codeHash_key" ON "CliAuthCode"("codeHash");

-- CreateIndex
CREATE INDEX "CliAuthCode_userId_idx" ON "CliAuthCode"("userId");

-- AddForeignKey
ALTER TABLE "CliAuthCode" ADD CONSTRAINT "CliAuthCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
