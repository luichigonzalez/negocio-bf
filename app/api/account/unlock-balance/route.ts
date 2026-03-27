import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/app/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
      select: {
        id: true,
        isActive: true,
        availableBalance: true,
        lockedBalance: true,
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
        { ok: false, error: "La cuenta debe estar activa" },
        { status: 400 }
      );
    }

    if (user.lockedBalance <= 0) {
      return NextResponse.json(
        { ok: false, error: "No hay saldo bloqueado para liberar" },
        { status: 400 }
      );
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        availableBalance: {
          increment: user.lockedBalance,
        },
        lockedBalance: 0,
      },
    });

    return NextResponse.json({
      ok: true,
      message: "Saldo liberado correctamente",
    });
  } catch (error) {
    console.error("POST /api/account/unlock-balance error:", error);

    return NextResponse.json(
      { ok: false, error: "Error interno al liberar saldo" },
      { status: 500 }
    );
  }
}