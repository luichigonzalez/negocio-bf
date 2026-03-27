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

    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        isActive: true,
      },
    });

    if (!existingUser) {
      return NextResponse.json(
        { ok: false, error: "Usuario no encontrado" },
        { status: 404 }
      );
    }

    if (existingUser.isActive) {
      return NextResponse.json({
        ok: true,
        message: "La cuenta ya está activa",
      });
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        isActive: true,
      },
    });

    return NextResponse.json({
      ok: true,
      message: "Cuenta activada correctamente",
    });
  } catch (error) {
    console.error("POST /api/account/activate error:", error);

    return NextResponse.json(
      { ok: false, error: "Error interno al activar la cuenta" },
      { status: 500 }
    );
  }
}