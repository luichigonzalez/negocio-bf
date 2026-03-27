import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function getIpnCallbackUrl(req: NextRequest) {
  const envUrl = process.env.NOWPAYMENTS_PAYOUT_IPN_URL?.trim();
  if (envUrl) return envUrl;

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (() => {
      const host = req.headers.get("host");
      const proto =
        req.headers.get("x-forwarded-proto") ||
        (host?.includes("localhost") ? "http" : "https");
      return host ? `${proto}://${host}` : "";
    })();

  return baseUrl
    ? `${baseUrl.replace(/\/+$/, "")}/api/nowpayments/payouts/ipn`
    : "";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    const withdrawalId = String(body?.withdrawalId || "").trim();

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
      currentStatus !== "AUTO_READY" &&
      currentStatus !== "APPROVED" &&
      currentStatus !== "PENDING"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "Este retiro no está en estado ejecutable",
          status: withdrawal.status,
        },
        { status: 400 }
      );
    }

    if (withdrawal.providerWithdrawalId || withdrawal.externalPayoutId) {
      return NextResponse.json(
        {
          ok: true,
          alreadySent: true,
          withdrawal: {
            id: withdrawal.id,
            status: withdrawal.status,
            providerWithdrawalId: withdrawal.providerWithdrawalId,
            externalPayoutId: withdrawal.externalPayoutId,
            providerStatus: withdrawal.providerStatus,
            txHash: withdrawal.txHash,
          },
        },
        { status: 200 }
      );
    }

    const wallet =
      withdrawal.walletAddress?.trim() ||
      withdrawal.promoterProfile?.usdtAddress?.trim() ||
      "";
    const network =
      withdrawal.network ||
      withdrawal.promoterProfile?.usdtNetwork ||
      "TRC20";

    if (!wallet) {
      return NextResponse.json(
        { ok: false, error: "Wallet de destino no configurada" },
        { status: 400 }
      );
    }

    if (!withdrawal.promoterProfile?.isUsdtAddressLocked) {
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

    const amount = Number(withdrawal.amount) || 0;
    if (amount <= 0) {
      return NextResponse.json(
        { ok: false, error: "Monto de retiro inválido" },
        { status: 400 }
      );
    }

    const nowpaymentsApiKey = process.env.NOWPAYMENTS_API_KEY?.trim();
    if (!nowpaymentsApiKey) {
      return NextResponse.json(
        { ok: false, error: "NOWPAYMENTS_API_KEY no configurada" },
        { status: 500 }
      );
    }

    const ipnCallbackUrl = getIpnCallbackUrl(req);

    const providerPayload = {
      ipn_callback_url: ipnCallbackUrl || undefined,
      withdrawals: [
        {
          address: wallet,
          currency: "usdttrc20",
          amount,
          ipn_callback_url: ipnCallbackUrl || undefined,
        },
      ],
    };

    const providerRes = await fetch("https://api.nowpayments.io/v1/payout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": nowpaymentsApiKey,
      },
      body: JSON.stringify(providerPayload),
      cache: "no-store",
    });

    const providerData = await providerRes.json().catch(() => null);

    if (!providerRes.ok) {
      await prisma.withdrawalAudit.create({
        data: {
          withdrawalId: withdrawal.id,
          action: "WITHDRAWAL_EXECUTE_FAILED",
          statusFrom: currentStatus,
          statusTo: currentStatus,
          note: "Error enviando payout a NOWPayments",
          payload: {
            request: providerPayload,
            response: providerData,
            httpStatus: providerRes.status,
          },
        },
      });

      return NextResponse.json(
        {
          ok: false,
          error:
            providerData?.message ||
            providerData?.error ||
            "Error creando payout en NOWPayments",
          details: providerData,
        },
        { status: 502 }
      );
    }

    const providerWithdrawalId =
      providerData?.id?.toString?.() ||
      providerData?.withdrawals?.[0]?.id?.toString?.() ||
      null;

    const providerBatchId =
      providerData?.batch_withdrawal_id?.toString?.() ||
      providerData?.batch_id?.toString?.() ||
      null;

    const providerStatus = String(
      providerData?.status ||
        providerData?.withdrawals?.[0]?.status ||
        "PROCESSING"
    ).toUpperCase();

    const txHash =
      providerData?.hash?.toString?.() ||
      providerData?.withdrawals?.[0]?.hash?.toString?.() ||
      null;

    const updated = await prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: {
        status: "PROCESSING",
        processedAt: new Date(),
        providerWithdrawalId,
        providerBatchId,
        externalPayoutId: providerWithdrawalId,
        providerStatus,
        txHash,
        providerResponse: providerData,
        meta: {
          ...(withdrawal.meta && typeof withdrawal.meta === "object"
            ? withdrawal.meta
            : {}),
          executeRequest: providerPayload,
        },
      },
    });

    await prisma.withdrawalAudit.create({
      data: {
        withdrawalId: updated.id,
        action: "WITHDRAWAL_EXECUTED",
        statusFrom: currentStatus,
        statusTo: "PROCESSING",
        note: "Payout enviado a NOWPayments",
        payload: {
          request: providerPayload,
          response: providerData,
          providerWithdrawalId,
          providerBatchId,
          providerStatus,
          txHash,
        },
      },
    });

    return NextResponse.json({
      ok: true,
      withdrawal: {
        id: updated.id,
        status: updated.status,
        processedAt: updated.processedAt,
        providerWithdrawalId: updated.providerWithdrawalId,
        providerBatchId: updated.providerBatchId,
        externalPayoutId: updated.externalPayoutId,
        providerStatus: updated.providerStatus,
        txHash: updated.txHash,
      },
      provider: providerData,
    });
  } catch (error: any) {
    console.error("POST execute withdrawal error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Error ejecutando retiro",
      },
      { status: 500 }
    );
  }
}