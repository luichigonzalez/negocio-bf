/* app/api/test/users/find/route.ts */

import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function toStr(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const email = toStr(searchParams.get("email"));
    const referralCode = toStr(searchParams.get("ref"));
    const name = toStr(searchParams.get("name"));

    const where: any = {};

    if (email) {
      where.email = {
        contains: email,
        mode: "insensitive",
      };
    }

    if (referralCode) {
      where.referralCode = {
        contains: referralCode,
        mode: "insensitive",
      };
    }

    if (name) {
      where.name = {
        contains: name,
        mode: "insensitive",
      };
    }

    const users = await prisma.user.findMany({
      where: Object.keys(where).length ? where : undefined,
      select: {
        id: true,
        name: true,
        email: true,
        referralCode: true,
        referredById: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 20,
    });

    return NextResponse.json({
      ok: true,
      count: users.length,
      users,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Error buscando usuarios",
      },
      { status: 500 }
    );
  }
}