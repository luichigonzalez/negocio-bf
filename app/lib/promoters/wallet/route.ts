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

// 📌 GET → obtener wallet
export async function GET(req: Request) {
  try {
    const cookieHeader = req.headers.get("cookie") || "";
    const cookies = parseCookies(cookieHeader);

    const userId = cookies["userId"];

    if (!userId) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const profile = await prisma.promoterProfile.findUnique({
      where: { userId },
      select: {
        usdtAddress: true,
        usdtNetwork: true,
        isUsdtAddressLocked: true,
      },
    });

    return NextResponse.json({ ok: true, wallet: profile });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

// 📌 POST → guardar wallet
export async function POST(req: Request) {
  try {
    const cookieHeader = req.headers.get("cookie") || "";
    const cookies = parseCookies(cookieHeader);

    const userId = cookies["userId"];

    if (!userId) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const body = await req.json();
    const address = String(body.address || "").trim();

    if (!address) {
      return NextResponse.json(
        { ok: false, error: "Dirección inválida" },
        { status: 400 }
      );
    }

    const profile = await prisma.promoterProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        isUsdtAddressLocked: true,
      },
    });

    if (!profile) {
      return NextResponse.json(
        { ok: false, error: "Perfil no encontrado" },
        { status: 404 }
      );
    }

    // 🔒 si ya está bloqueada → no se puede cambiar
    if (profile.isUsdtAddressLocked) {
      return NextResponse.json(
        { ok: false, error: "La wallet ya está bloqueada" },
        { status: 403 }
      );
    }

    await prisma.promoterProfile.update({
      where: { id: profile.id },
      data: {
        usdtAddress: address,
        usdtNetwork: "TRC20",
        isUsdtAddressLocked: true,
      },
    });

    return NextResponse.json({
      ok: true,
      message: "Wallet guardada y bloqueada",
    });
  } catch (error) {
    console.error("wallet error:", error);

    return NextResponse.json(
      { ok: false, error: "Error interno" },
      { status: 500 }
    );
  }
}