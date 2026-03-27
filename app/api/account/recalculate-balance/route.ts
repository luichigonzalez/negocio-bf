import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/app/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REFERRAL_REWARD = 25;

export async function POST() {
  try {
    const cookieStore = await cookies();
    const userId = cookieStore.get("userId")?.value?.trim();

    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "No autorizado" },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        referrals: {
          select: { id: true },
        },
      },
    });

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Usuario no encontrado" },
        { status: 404 }
      );
    }

    if (!user.isActive) {
      return NextResponse.json(
        { ok: false, error: "Primero debes activar tu cuenta" },
        { status: 400 }
      );
    }

    const totalLockedBalance = user.referrals.length * REFERRAL_REWARD;

    await prisma.user.update({
      where: { id: userId },
      data: {
        availableBalance: 0,
        lockedBalance: totalLockedBalance,
      },
    });

    return NextResponse.json({
      ok: true,
      message: "Saldo bloqueado recalculado correctamente",
      directCount: user.referrals.length,
      availableBalance: 0,
      lockedBalance: totalLockedBalance,
    });
  } catch (error) {
    console.error("POST /api/account/recalculate-balance error:", error);

    return NextResponse.json(
      { ok: false, error: "Error interno al recalcular saldo" },
      { status: 500 }
    );
  }
}