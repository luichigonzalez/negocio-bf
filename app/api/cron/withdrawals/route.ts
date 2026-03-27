import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTO_PAYOUT_LIMIT = 200;
const CRON_SECRET = process.env.CRON_SECRET || "";

function parseAmount(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getBaseUrl(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_APP_URL?.trim()) {
    return process.env.NEXT_PUBLIC_APP_URL.trim().replace(/\/+$/, "");
  }

  const host = req.headers.get("host");
  const protocol =
    req.headers.get("x-forwarded-proto") ||
    (host?.includes("localhost") ? "http" : "https");

  if (!host) return "";
  return `${protocol}://${host}`;
}

function isAuthorized(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  const cronHeader = req.headers.get("x-cron-secret") || "";
  const urlSecret = req.nextUrl.searchParams.get("secret") || "";

  if (!CRON_SECRET) return true;

  return (
    bearer === CRON_SECRET ||
    cronHeader === CRON_SECRET ||
    urlSecret === CRON_SECRET
  );
}

function getWithdrawalModel() {
  const db = prisma as any;

  return (
    db.promoterWithdrawal ||
    db.withdrawal ||
    db.withdrawalRequest ||
    db.promoterWithdrawRequest ||
    db.payoutRequest ||
    null
  );
}

function getWithdrawalAuditModel() {
  const db = prisma as any;

  return (
    db.withdrawalAuditLog ||
    db.withdrawalAudit ||
    db.payoutAudit ||
    db.auditLog ||
    null
  );
}

async function createAuditLog(data: {
  withdrawalId: string;
  action: string;
  statusFrom: string;
  statusTo: string;
  note: string;
  payload?: unknown;
}) {
  const auditModel = getWithdrawalAuditModel();
  if (!auditModel) return;

  const candidates = [
    {
      withdrawalId: data.withdrawalId,
      action: data.action,
      statusFrom: data.statusFrom,
      statusTo: data.statusTo,
      note: data.note,
      payload: data.payload ?? null,
    },
    {
      withdrawalId: data.withdrawalId,
      action: data.action,
      note: data.note,
      payload: data.payload ?? null,
    },
    {
      entityId: data.withdrawalId,
      entityType: "WITHDRAWAL",
      action: data.action,
      note: data.note,
      payload: data.payload ?? null,
    },
  ];

  for (const candidate of candidates) {
    try {
      await auditModel.create({ data: candidate });
      return;
    } catch {
      // intenta con otra forma sin romper
    }
  }
}

export async function GET(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { ok: false, error: "No autorizado" },
        { status: 401 }
      );
    }

    const baseUrl = getBaseUrl(req);

    if (!baseUrl) {
      return NextResponse.json(
        { ok: false, error: "No se pudo resolver la URL base" },
        { status: 500 }
      );
    }

    const withdrawalModel = getWithdrawalModel();

    if (!withdrawalModel) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No se encontró un modelo de retiros compatible en Prisma",
        },
        { status: 500 }
      );
    }

    const withdrawals = await withdrawalModel.findMany({
      where: {
        status: "AUTO_READY",
        providerWithdrawalId: null,
      },
      orderBy: {
        createdAt: "asc",
      },
      take: 25,
      select: {
        id: true,
        amount: true,
        status: true,
      },
    });

    if (!withdrawals.length) {
      return NextResponse.json({
        ok: true,
        message: "No hay retiros AUTO_READY pendientes",
        totalFound: 0,
        executed: 0,
        failed: 0,
        skipped: 0,
        results: [],
      });
    }

    const results: Array<{
      withdrawalId: string;
      amount: number;
      ok: boolean;
      status?: number;
      result?: any;
      error?: string;
    }> = [];

    let executed = 0;
    let failed = 0;
    let skipped = 0;

    for (const withdrawal of withdrawals) {
      const amount = parseAmount(withdrawal.amount);

      if (amount > AUTO_PAYOUT_LIMIT) {
        skipped++;

        results.push({
          withdrawalId: withdrawal.id,
          amount,
          ok: false,
          error: `Saltado: supera límite automático de ${AUTO_PAYOUT_LIMIT} USDT`,
        });

        await createAuditLog({
          withdrawalId: withdrawal.id,
          action: "AUTO_PAYOUT_SKIPPED",
          statusFrom: "AUTO_READY",
          statusTo: "AUTO_READY",
          note: `Retiro omitido por superar límite automático (${amount} USDT)`,
          payload: {
            amount,
            autoLimit: AUTO_PAYOUT_LIMIT,
          },
        });

        continue;
      }

      try {
        const res = await fetch(`${baseUrl}/api/promotores/retiros/execute`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            withdrawalId: withdrawal.id,
          }),
          cache: "no-store",
        });

        const data = await res.json().catch(() => null);

        if (res.ok && data?.ok) {
          executed++;

          results.push({
            withdrawalId: withdrawal.id,
            amount,
            ok: true,
            status: res.status,
            result: data,
          });

          await createAuditLog({
            withdrawalId: withdrawal.id,
            action: "AUTO_PAYOUT_EXECUTED",
            statusFrom: "AUTO_READY",
            statusTo: "PROCESSING",
            note: "Cron ejecutó envío automático de retiro",
            payload: data,
          });
        } else {
          failed++;

          results.push({
            withdrawalId: withdrawal.id,
            amount,
            ok: false,
            status: res.status,
            result: data,
            error: data?.error || "Error desconocido ejecutando payout automático",
          });

          await createAuditLog({
            withdrawalId: withdrawal.id,
            action: "AUTO_PAYOUT_FAILED",
            statusFrom: "AUTO_READY",
            statusTo: "AUTO_READY",
            note: data?.error || "Fallo en cron al ejecutar payout automático",
            payload: data || {
              status: res.status,
            },
          });
        }
      } catch (error: any) {
        failed++;

        results.push({
          withdrawalId: withdrawal.id,
          amount,
          ok: false,
          error: error?.message || "Error interno en cron",
        });

        await createAuditLog({
          withdrawalId: withdrawal.id,
          action: "AUTO_PAYOUT_FAILED",
          statusFrom: "AUTO_READY",
          statusTo: "AUTO_READY",
          note: error?.message || "Error interno en cron",
          payload: {
            error: error?.message || "unknown_error",
          },
        });
      }
    }

    return NextResponse.json({
      ok: true,
      totalFound: withdrawals.length,
      executed,
      failed,
      skipped,
      results,
    });
  } catch (error: any) {
    console.error("GET /api/cron/withdrawals error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Error interno en cron de retiros",
      },
      { status: 500 }
    );
  }
}