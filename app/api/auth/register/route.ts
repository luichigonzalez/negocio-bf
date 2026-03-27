import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REFERRAL_REWARD = 25;

type RegisterBody = {
  username?: string;
  email?: string;
  password?: string;
  sponsorCode?: string;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function generateReferralCode(username: string) {
  const clean = username.replace(/\s+/g, "").toUpperCase();
  const random = Math.floor(1000 + Math.random() * 9000);
  return `BF${clean.slice(0, 6)}${random}`;
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Ruta /api/auth/register funcionando. Usar método POST.",
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as RegisterBody;

    const username = normalizeText(body.username);
    const email = normalizeEmail(body.email);
    const password = normalizeText(body.password);
    const sponsorCode = normalizeText(body.sponsorCode).toUpperCase();

    if (!username) {
      return NextResponse.json(
        { ok: false, error: "El usuario es obligatorio" },
        { status: 400 }
      );
    }

    if (!email) {
      return NextResponse.json(
        { ok: false, error: "El email es obligatorio" },
        { status: 400 }
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { ok: false, error: "Email inválido" },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { ok: false, error: "La contraseña debe tener al menos 6 caracteres" },
        { status: 400 }
      );
    }

    const existingByEmail = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingByEmail) {
      return NextResponse.json(
        { ok: false, error: "Ese email ya está registrado" },
        { status: 409 }
      );
    }

    const existingByName = await prisma.user.findFirst({
      where: { name: username },
      select: { id: true },
    });

    if (existingByName) {
      return NextResponse.json(
        { ok: false, error: "Ese usuario ya está registrado" },
        { status: 409 }
      );
    }

    let sponsorUser:
      | {
          id: string;
          isActive: boolean;
          promoterProfile: {
            id: string;
          } | null;
        }
      | null = null;

    if (sponsorCode) {
      sponsorUser = await prisma.user.findUnique({
        where: { referralCode: sponsorCode },
        select: {
          id: true,
          isActive: true,
          promoterProfile: {
            select: {
              id: true,
            },
          },
        },
      });

      if (!sponsorUser) {
        return NextResponse.json(
          { ok: false, error: "El código de referido no existe" },
          { status: 404 }
        );
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    let referralCode = generateReferralCode(username);

    for (let i = 0; i < 10; i++) {
      const exists = await prisma.user.findUnique({
        where: { referralCode },
        select: { id: true },
      });

      if (!exists) break;
      referralCode = generateReferralCode(username);
    }

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: username,
          email,
          passwordHash: hashedPassword,
          referralCode,
          referredById: sponsorUser?.id ?? null,
        },
      });

      const promoterProfile = await tx.promoterProfile.create({
        data: {
          userId: user.id,
          username,
          email,
          referralCode,
          sponsorPromoterProfileId: sponsorUser?.promoterProfile?.id ?? null,
          directReferralCount: 0,
          activeLevel: 1,
          activeCycleLevel: 1,
          cycleLevel: 1,
          activeCycle: 1,
          activeCycleNumber: 1,
          cycleNumber: 1,
          isCycleUnlocked: false,
          cycleUnlocked: false,
          canEarn: false,
          membershipActive: false,
          membershipStatus: "PENDING",
          walletBalance: 0,
          earningsBalance: 0,
          availableBalance: 0,
          totalDirectEarnings: 0,
          totalEarnings: 0,
        },
      });

      if (sponsorUser?.promoterProfile?.id) {
        await tx.promoterProfile.update({
          where: { id: sponsorUser.promoterProfile.id },
          data: {
            directReferralCount: {
              increment: 1,
            },
          },
        });
      }

      if (sponsorUser?.isActive) {
        await tx.user.update({
          where: { id: sponsorUser.id },
          data: {
            lockedBalance: {
              increment: REFERRAL_REWARD,
            },
          },
        });
      }

      return { user, promoterProfile };
    });

    const response = NextResponse.json(
      {
        ok: true,
        message: "Usuario registrado correctamente",
        user: {
          id: created.user.id,
          username: created.user.name,
          email: created.user.email,
          referralCode: created.user.referralCode,
        },
        promoterProfile: {
          id: created.promoterProfile.id,
          sponsorPromoterProfileId:
            created.promoterProfile.sponsorPromoterProfileId ?? null,
        },
      },
      { status: 201 }
    );

    response.cookies.set("userId", String(created.user.id), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    return response;
  } catch (error) {
    console.error("POST /api/auth/register error:", error);

    return NextResponse.json(
      { ok: false, error: "Error interno al registrar usuario" },
      { status: 500 }
    );
  }
}