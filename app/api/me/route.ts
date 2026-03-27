import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/app/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
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
          select: {
            id: true,
            name: true,
            email: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: "desc",
          },
        },
        referredBy: {
          select: {
            id: true,
            name: true,
            email: true,
            referralCode: true,
          },
        },
      },
    });

    if (!user) {
      const response = NextResponse.json(
        { ok: false, error: "No encontrado" },
        { status: 401 }
      );

      response.cookies.set("userId", "", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        expires: new Date(0),
      });

      return response;
    }

    return NextResponse.json({
      ok: true,
      id: user.id,
      username: user.name,
      email: user.email,
      referralCode: user.referralCode,
      referredById: user.referredById,
      isActive: user.isActive,
      availableBalance: user.availableBalance,
      lockedBalance: user.lockedBalance,
      sponsor: user.referredBy
        ? {
            id: user.referredBy.id,
            username: user.referredBy.name,
            email: user.referredBy.email,
            referralCode: user.referredBy.referralCode,
          }
        : null,
      directCount: user.referrals.length,
      referrals: user.referrals.map((ref) => ({
        id: ref.id,
        username: ref.name,
        email: ref.email,
        createdAt: ref.createdAt,
      })),
      user: {
        id: user.id,
        username: user.name,
        email: user.email,
        referralCode: user.referralCode,
        referredById: user.referredById,
        isActive: user.isActive,
        availableBalance: user.availableBalance,
        lockedBalance: user.lockedBalance,
      },
    });
  } catch (error) {
    console.error("GET /api/me error:", error);

    return NextResponse.json(
      { ok: false, error: "Error interno" },
      { status: 500 }
    );
  }
}