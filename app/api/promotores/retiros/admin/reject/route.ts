import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    const withdrawalId = String(body?.withdrawalId || "").trim();
    const adminUserId = String(body?.adminUserId || "system").trim();
    const reason = String(body?.reason || body?.note || "").trim();

    if (!withdrawalId) {
      return NextResponse.json(
        { ok: false, error: "withdrawalId es obligatorio" },
        { status: 400 }
      );
    }

    const withdrawal = await prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
      include: {
        promoterProfile: {
          select: {
            id: true,
            userId: true,
            availableBalance: true,
          },
        },
      },
    });

    if (!withdrawal) {
      return NextResponse.json(
        { ok: false, error: "Retiro no encontrado" },
        { status: 404 }
      );
    }

    const currentStatus = String(withdrawal.status || "").toUpperCase();

    if (
      currentStatus === "PAID" ||
      currentStatus === "FAILED" ||
      currentStatus === "REJECTED"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "Este retiro ya no puede rechazarse",
          status: withdrawal.status,
        },
        { status: 400 }
      );
    }

    const rejectionReason = reason || "Retiro rechazado por administración";

    const result = await prisma.$transaction(async (tx) => {
      const updatedWithdrawal = await tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: {
          status: "REJECTED",
          rejectedAt: new Date(),
          rejectionReason,
          providerError: rejectionReason,
          reviewRequired: true,
        },
      });

      await tx.promoterProfile.update({
        where: { id: withdrawal.promoterProfileId },
        data: {
          availableBalance: {
            increment: Number(withdrawal.amount) || 0,
          },
        },
      });

      await tx.walletMovement.create({
        data: {
          promoterProfileId: withdrawal.promoterProfileId,
          type: "WITHDRAWAL_REJECTED_REFUND",
          amount: Number(withdrawal.amount) || 0,
          currency: withdrawal.currency || "USDT",
          status: "COMPLETED",
          description: `Reembolso por rechazo de retiro ${withdrawal.id}`,
          referenceId: withdrawal.id,
          meta: {
            withdrawalId: withdrawal.id,
            adminUserId,
            reason: rejectionReason,
          },
        },
      });

      await tx.withdrawalAudit.create({
        data: {
          withdrawalId: withdrawal.id,
          action: "WITHDRAWAL_REJECTED",
          statusFrom: currentStatus,
          statusTo: "REJECTED",
          note: rejectionReason,
          payload: {
            adminUserId,
            withdrawalId: withdrawal.id,
            refundedAmount: Number(withdrawal.amount) || 0,
            reason: rejectionReason,
          },
        },
      });

      return updatedWithdrawal;
    });

    return NextResponse.json({
      ok: true,
      withdrawal: {
        id: result.id,
        status: result.status,
        rejectedAt: result.rejectedAt,
        rejectionReason: result.rejectionReason,
      },
    });
  } catch (error: any) {
    console.error("POST admin reject withdrawal error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Error rechazando retiro",
      },
      { status: 500 }
    );
  }
}