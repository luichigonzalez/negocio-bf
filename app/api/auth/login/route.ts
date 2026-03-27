import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type LoginBody = {
  email?: string;
  username?: string;
  identifier?: string;
  password?: string;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown) {
  return normalizeText(value).toLowerCase();
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as LoginBody;

    const rawIdentifier =
      normalizeText(body.identifier) ||
      normalizeText(body.username) ||
      normalizeText(body.email);

    const password = normalizeText(body.password);

    if (!rawIdentifier || !password) {
      return NextResponse.json(
        { ok: false, error: "Faltan datos" },
        { status: 400 }
      );
    }

    const identifier = rawIdentifier.toLowerCase();

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: identifier },
          { name: rawIdentifier },
          { name: identifier },
        ],
      },
    });

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Usuario no encontrado" },
        { status: 404 }
      );
    }

    const passwordOk = await bcrypt.compare(password, user.passwordHash);

    if (!passwordOk) {
      return NextResponse.json(
        { ok: false, error: "Contraseña incorrecta" },
        { status: 401 }
      );
    }

    const response = NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        username: user.name,
        email: user.email,
        referralCode: user.referralCode,
      },
    });

    response.cookies.set("userId", String(user.id), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    return response;
  } catch (error) {
    console.error("LOGIN_ERROR", error);

    return NextResponse.json(
      { ok: false, error: "Error interno al iniciar sesión" },
      { status: 500 }
    );
  }
}