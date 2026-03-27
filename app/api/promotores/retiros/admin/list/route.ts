import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AdminWithdrawalListItem = {
  id: string;
  amount: number;
  currency: string;
  network: string;
  walletAddress: string;
  status: string;
  autoProcess: boolean;
  reviewRequired: boolean;
  externalPayoutId: string | null;
  providerWithdrawalId: string | null;
  providerBatchId: string | null;
  providerStatus: string | null;
  providerError: string | null;
  txHash: string | null;
  approvedAt: Date | null;
  processedAt: Date | null;
  paidAt: Date | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  promoterProfile: {
    id: string;
    userId: string;
    name: string | null;
    username: string | null;
    email: string | null;
    usdtAddress: string | null;
    usdtNetwork: string | null;
    isUsdtAddressLocked: boolean;
  } | null;
};

function parsePositiveInt(value: string | null, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const statusParam = String(searchParams.get("status") || "").trim();
    const page = parsePositiveInt(searchParams.get("page"), 1);
    const pageSize = Math.min(parsePositiveInt(searchParams.get("pageSize"), 20), 100);
    const skip = (page - 1) * pageSize;

    const where = statusParam
      ? {
          status: statusParam,
        }
      : {};

    const [withdrawals, total] = await Promise.all([
      prisma.withdrawal.findMany({
        where,
        orderBy: {
          createdAt: "desc",
        },
        skip,
        take: pageSize,
        include: {
          promoterProfile: {
            select: {
              id: true,
              userId: true,
              name: true,
              username: true,
              email: true,
              usdtAddress: true,
              usdtNetwork: true,
              isUsdtAddressLocked: true,
            },
          },
        },
      }),
      prisma.withdrawal.count({ where }),
    ]);

    return NextResponse.json({
      ok: true,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      withdrawals: withdrawals.map((item: AdminWithdrawalListItem) => ({
        id: item.id,
        amount: item.amount,
        currency: item.currency,
        network: item.network,
        walletAddress: item.walletAddress,
        status: item.status,
        autoProcess: item.autoProcess,
        reviewRequired: item.reviewRequired,
        externalPayoutId: item.externalPayoutId,
        providerWithdrawalId: item.providerWithdrawalId,
        providerBatchId: item.providerBatchId,
        providerStatus: item.providerStatus,
        providerError: item.providerError,
        txHash: item.txHash,
        approvedAt: item.approvedAt,
        processedAt: item.processedAt,
        paidAt: item.paidAt,
        rejectedAt: item.rejectedAt,
        rejectionReason: item.rejectionReason,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        promoterProfile: item.promoterProfile
          ? {
              id: item.promoterProfile.id,
              userId: item.promoterProfile.userId,
              name: item.promoterProfile.name,
              username: item.promoterProfile.username,
              email: item.promoterProfile.email,
              usdtAddress: item.promoterProfile.usdtAddress,
              usdtNetwork: item.promoterProfile.usdtNetwork,
              isUsdtAddressLocked: item.promoterProfile.isUsdtAddressLocked,
            }
          : null,
      })),
    });
  } catch (error: any) {
    console.error("GET admin withdrawals list error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Error listando retiros",
      },
      { status: 500 }
    );
  }
}