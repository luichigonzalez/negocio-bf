import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIN_WITHDRAW = 5;
const AUTO_PAYOUT_LIMIT = 200;
const NETWORK = "TRC20";
const CURRENCY = "USDT";

function parseCookies(cookieHeader: string) {
  if (!cookieHeader) return {};

  return Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const [k, ...v] = c.trim().split("=");
      return [k, decodeURIComponent(v.join("="))];
    })
  );
}

function toNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(req: Request) {
  try {
    const cookieHeader = req.headers.get("cookie") || "";
    const cookies = parseCookies(cookieHeader);
    const userId = cookies["userId"];

    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "No autenticado" },
        { status: 401 }
      );
    }

    const profile = await prisma.promoterProfile.findUnique({
      where: { userId },
      select: {
        id: true,
      },
    });

    if (!profile) {
      return NextResponse.json(
        { ok: false, error: "Perfil no encontrado" },
        { status: 404 }
      );
    }

    const withdrawals = await prisma.withdrawal.findMany({
      where: { promoterProfileId: profile.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json({
      ok: true,
      withdrawals,
    });
  } catch (error) {
    console.error("GET payout error:", error);

    return NextResponse.json(
      { ok: false, error: "Error interno" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const cookieHeader = req.headers.get("cookie") || "";
    const cookies = parseCookies(cookieHeader);
    const userId = cookies["userId"];

    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "No autenticado" },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const amount = toNumber(body.amount, 0);

    if (amount <= 0) {
      return NextResponse.json(
        { ok: false, error: "Monto inválido" },
        { status: 400 }
      );
    }

    if (amount < MIN_WITHDRAW) {
      return NextResponse.json(
        {
          ok: false,
          error: `El retiro mínimo es de ${MIN_WITHDRAW} ${CURRENCY}`,
        },
        { status: 400 }
      );
    }

    const profile = await prisma.promoterProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        membershipActive: true,
        directReferralCount: true,
        directReferralsCount: true,
        availableBalance: true,
        totalWithdrawn: true,
        usdtAddress: true,
        usdtNetwork: true,
        isUsdtAddressLocked: true,
      },
    });

    if (!profile) {
      return NextResponse.json(
        { ok: false, error: "Perfil no encontrado" },
        { status: 404 }
      );
    }

    if (!profile.membershipActive) {
      return NextResponse.json(
        { ok: false, error: "Tu cuenta no está activa" },
        { status: 403 }
      );
    }

    const directCount = Math.max(
      toNumber(profile.directReferralCount, 0),
      toNumber(profile.directReferralsCount, 0)
    );

    if (directCount < 2) {
      return NextResponse.json(
        {
          ok: false,
          error: "Necesitas 2 referidos directos activos para retirar",
        },
        { status: 403 }
      );
    }

    const walletAddress = String(profile.usdtAddress || "").trim();
    const walletNetwork = String(profile.usdtNetwork || "").trim().toUpperCase();

    if (!walletAddress) {
      return NextResponse.json(
        { ok: false, error: "Debes guardar tu wallet USDT antes de retirar" },
        { status: 400 }
      );
    }

    if (!profile.isUsdtAddressLocked) {
      return NextResponse.json(
        { ok: false, error: "La wallet debe estar bloqueada para retirar" },
        { status: 400 }
      );
    }

    if (walletNetwork !== NETWORK) {
      return NextResponse.json(
        { ok: false, error: `Solo se permite red ${NETWORK}` },
        { status: 400 }
      );
    }

    const availableBalance = toNumber(profile.availableBalance, 0);

    if (availableBalance < amount) {
      return NextResponse.json(
        { ok: false, error: "Saldo disponible insuficiente" },
        { status: 400 }
      );
    }

    const pendingCount = await prisma.withdrawal.count({
      where: {
        promoterProfileId: profile.id,
        status: {
          in: ["PENDING", "AUTO_READY", "APPROVED", "PROCESSING"],
        },
      },
    });

    if (pendingCount > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Ya tienes un retiro pendiente o en proceso",
        },
        { status: 409 }
      );
    }

    const autoProcess = amount <= AUTO_PAYOUT_LIMIT;
    const status = autoProcess ? "AUTO_READY" : "PENDING";

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.promoterProfile.updateMany({
        where: {
          id: profile.id,
          availableBalance: {
            gte: amount,
          },
        },
        data: {
          availableBalance: {
            decrement: amount,
          },
        },
      });

      if (updated.count === 0) {
        throw new Error("Saldo insuficiente al confirmar retiro");
      }

      const withdrawal = await tx.withdrawal.create({
        data: {
          promoterProfileId: profile.id,
          amount,
          currency: CURRENCY,
          network: NETWORK,
          walletAddress,
          status,
          autoProcess,
          reviewRequired: !autoProcess,
          meta: {
            directCount,
            minWithdraw: MIN_WITHDRAW,
            autoPayoutLimit: AUTO_PAYOUT_LIMIT,
          },
        },
      });

      await tx.walletMovement.create({
        data: {
          promoterProfileId: profile.id,
          type: "WITHDRAW_REQUEST",
          amount,
          currency: CURRENCY,
          status,
          description: autoProcess
            ? "Solicitud de retiro lista para auto payout"
            : "Solicitud de retiro pendiente de revisión manual",
          referenceId: withdrawal.id,
          meta: {
            withdrawalId: withdrawal.id,
            walletAddress,
            network: NETWORK,
            autoProcess,
          },
        },
      });

      return withdrawal;
    });

    return NextResponse.json({
      ok: true,
      message: autoProcess
        ? "Retiro creado y listo para auto payout"
        : "Retiro creado y enviado a revisión manual",
      withdrawal: result,
      rules: {
        minWithdraw: MIN_WITHDRAW,
        autoPayoutLimit: AUTO_PAYOUT_LIMIT,
        network: NETWORK,
      },
    });
  } catch (error: any) {
    console.error("POST payout error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Error interno al crear retiro",
      },
      { status: 500 }
    );
  }
}