/* app/api/test/prisma-models/route.ts */

import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const db = prisma as any;

    const keys = Object.keys(db)
      .filter((key) => {
        const value = db[key];
        return value && typeof value === "object" && typeof value.findMany === "function";
      })
      .sort();

    return NextResponse.json({
      ok: true,
      models: keys,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Error leyendo modelos de Prisma",
      },
      { status: 500 }
    );
  }
}