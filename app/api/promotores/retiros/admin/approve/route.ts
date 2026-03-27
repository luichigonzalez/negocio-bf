import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTO_PAYOUT_LIMIT = 200;

function parseAmount(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeNetwork(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/_/g, "")
    .replace(/-/g, "");
}

function isTRC20Network(value: string | null | undefined) {
  const network = normalizeNetwork(value);
  return network === "TRC20" || network === "USDTTRC20";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    const withdrawalId = String(body?.withdrawalId || "").trim();
    const adminUserId = String(body?.adminUserId || "system").trim();
    const note = String(body?.note || "").trim();

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
            usdtAddress: true,
            usdtNetwork: true,
            isUsdtAddressLocked: true,
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
      currentStatus !== "PENDING_REVIEW" &&
      currentStatus !== "PENDING" &&
      currentStatus !== "REQUESTED"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "Este retiro no está en estado aprobable",
          status: withdrawal.status,
        },
        { status: 400 }
      );
    }

    if (withdrawal.providerWithdrawalId || withdrawal.externalPayoutId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Este retiro ya fue enviado al proveedor",
          providerWithdrawalId: withdrawal.providerWithdrawalId,
          externalPayoutId: withdrawal.externalPayoutId,
          providerStatus: withdrawal.providerStatus,
        },
        { status: 409 }
      );
    }

    const amount = parseAmount(withdrawal.amount);
    const wallet =
      withdrawal.walletAddress?.trim() ||
      withdrawal.promoterProfile?.usdtAddress?.trim() ||
      "";
    const network =
      withdrawal.network ||
      withdrawal.promoterProfile?.usdtNetwork ||
      "TRC20";
    const walletLocked = !!withdrawal.promoterProfile?.isUsdtAddressLocked;

    if (!wallet) {
      return NextResponse.json(
        { ok: false, error: "El promotor no tiene wallet configurada" },
        { status: 400 }
      );
    }

    if (!walletLocked) {
      return NextResponse.json(
        { ok: false, error: "La wallet del promotor no está bloqueada" },
        { status: 400 }
      );
    }

    if (!isTRC20Network(network)) {
      return NextResponse.json(
        { ok: false, error: "La wallet del promotor no es TRC20" },
        { status: 400 }
      );
    }

    const nextStatus = amount <= AUTO_PAYOUT_LIMIT ? "AUTO_READY" : "APPROVED";

    const updated = await prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: {
        status: nextStatus,
        approvedAt: new Date(),
        reviewRequired: nextStatus !== "AUTO_READY",
        walletAddress: wallet,
        network: "TRC20",
        meta: {
          ...(withdrawal.meta && typeof withdrawal.meta === "object"
            ? withdrawal.meta
            : {}),
          approvedByAdminUserId: adminUserId,
          approvedNote: note || null,
          approvedAutomaticallyEligible: nextStatus === "AUTO_READY",
        },
      },
    });

    await prisma.withdrawalAudit.create({
      data: {
        withdrawalId: updated.id,
        action: "WITHDRAWAL_APPROVED",
        statusFrom: currentStatus,
        statusTo: nextStatus,
        note:
          note ||
          (nextStatus === "AUTO_READY"
            ? "Retiro aprobado por admin. Queda listo para auto payout."
            : "Retiro aprobado por admin. Queda aprobado para payout manual."),
        payload: {
          adminUserId,
          withdrawalId: updated.id,
          amount,
          wallet,
          network: "TRC20",
          autoLimit: AUTO_PAYOUT_LIMIT,
          autoExecution: nextStatus === "AUTO_READY",
        },
      },
    });

    return NextResponse.json({
      ok: true,
      withdrawal: {
        id: updated.id,
        status: updated.status,
        approvedAt: updated.approvedAt,
        autoReady: updated.status === "AUTO_READY",
      },
    });
  } catch (error: any) {
    console.error("POST admin approve withdrawal error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Error aprobando retiro",
      },
      { status: 500 }
    );
  }
}