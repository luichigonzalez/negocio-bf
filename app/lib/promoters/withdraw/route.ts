import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseCookies(cookieHeader: string) {
  if (!cookieHeader) return {};

  return Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const [k, ...v] = c.trim().split("=");
      return [k, decodeURIComponent(v.join("="))];
    })
  );
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

    const body = await req.json();
    const amount = Number(body.amount);

    if (!amount || amount <= 0) {
      return NextResponse.json(
        { ok: false, error: "Monto inválido" },
        { status: 400 }
      );
    }

    const promoter = await prisma.promoterProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        availableBalance: true,
        directReferralCount: true,
        membershipActive: true,
      },
    });

    if (!promoter) {
      return NextResponse.json(
        { ok: false, error: "Perfil no encontrado" },
        { status: 404 }
      );
    }

    // 🔒 REGLA 1: debe estar activo
    if (!promoter.membershipActive) {
      return NextResponse.json(
        { ok: false, error: "Cuenta no activa" },
        { status: 403 }
      );
    }

    // 🔒 REGLA 2: debe tener 2 directos
    if ((promoter.directReferralCount || 0) < 2) {
      return NextResponse.json(
        {
          ok: false,
          error: "Necesitas 2 referidos directos activos para retirar",
        },
        { status: 403 }
      );
    }

    // 🔒 REGLA 3: saldo disponible suficiente
    if ((promoter.availableBalance || 0) < amount) {
      return NextResponse.json(
        { ok: false, error: "Saldo insuficiente" },
        { status: 400 }
      );
    }

    // 💰 ejecutar retiro
    await prisma.$transaction(async (tx) => {
      await tx.promoterProfile.update({
        where: { id: promoter.id },
        data: {
          availableBalance: {
            decrement: amount,
          },
        },
      });

      await tx.walletMovement.create({
        data: {
          promoterProfileId: promoter.id,
          type: "WITHDRAW",
          amount,
          currency: "USDT",
          status: "PENDING",
          description: "Solicitud de retiro",
        },
      });
    });

    return NextResponse.json({
      ok: true,
      message: "Solicitud de retiro enviada",
    });
  } catch (error) {
    console.error("withdraw error:", error);

    return NextResponse.json(
      { ok: false, error: "Error interno" },
      { status: 500 }
    );
  }
}