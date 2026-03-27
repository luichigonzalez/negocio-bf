import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NowPaymentsPayoutIpn = {
  id?: string | number | null;
  batch_withdrawal_id?: string | number | null;
  status?: string | null;
  error?: string | null;
  currency?: string | null;
  amount?: string | number | null;
  address?: string | null;
  fee?: unknown;
  extra_id?: string | null;
  hash?: string | null;
  ipn_callback_url?: string | null;
  created_at?: string | null;
  requested_at?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
};

function sortObject(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(sortObject);
  }

  if (obj && typeof obj === "object") {
    return Object.keys(obj as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortObject((obj as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }

  return obj;
}

function verifyNowPaymentsSignature(
  payload: Record<string, unknown>,
  signature: string,
  secret: string
) {
  const sortedPayload = sortObject(payload);
  const expected = crypto
    .createHmac("sha512", secret)
    .update(JSON.stringify(sortedPayload))
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(signature, "utf8")
    );
  } catch {
    return false;
  }
}

function normalizeStatus(status: unknown): string {
  return String(status || "")
    .trim()
    .toUpperCase();
}

function mapProviderStatusToInternal(status: string): "PAID" | "FAILED" | "PROCESSING" {
  if (status === "FINISHED") return "PAID";
  if (status === "FAILED") return "FAILED";
  return "PROCESSING";
}

function toIsoDate(value: unknown): Date | undefined {
  if (!value || typeof value !== "string") return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

function toStringOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return String(value);
}

async function getModel(nameList: string[]) {
  for (const name of nameList) {
    const model = (prisma as any)[name];
    if (model) return model;
  }
  return null;
}

async function findWithdrawalByProviderIds(payload: NowPaymentsPayoutIpn) {
  const withdrawalModel = await getModel([
    "withdrawalRequest",
    "withdrawal",
    "promoterWithdrawal",
    "promoterWithdrawRequest",
    "payoutRequest",
    "payout",
  ]);

  if (!withdrawalModel) {
    return { model: null, row: null };
  }

  const payoutId = toStringOrNull(payload.id);
  const batchId = toStringOrNull(payload.batch_withdrawal_id);
  const hash = toStringOrNull(payload.hash);

  const whereCandidates = [
    payoutId ? { nowpaymentsPayoutId: payoutId } : null,
    payoutId ? { payoutId } : null,
    payoutId ? { externalPayoutId: payoutId } : null,
    payoutId ? { providerPayoutId: payoutId } : null,
    batchId ? { nowpaymentsBatchWithdrawalId: batchId } : null,
    batchId ? { batchWithdrawalId: batchId } : null,
    batchId ? { providerBatchId: batchId } : null,
    hash ? { txHash: hash } : null,
    hash ? { txid: hash } : null,
  ].filter(Boolean) as Record<string, unknown>[];

  if (whereCandidates.length === 0) {
    return { model: withdrawalModel, row: null };
  }

  for (const where of whereCandidates) {
    try {
      const row = await withdrawalModel.findFirst({ where });
      if (row) {
        return { model: withdrawalModel, row };
      }
    } catch {
      // sigue probando otros campos/modelos sin romper
    }
  }

  return { model: withdrawalModel, row: null };
}

async function safeUpdateWithdrawal(
  model: any,
  rowId: string,
  payload: NowPaymentsPayoutIpn,
  providerStatus: string,
  internalStatus: "PAID" | "FAILED" | "PROCESSING"
) {
  const payoutId = toStringOrNull(payload.id);
  const batchId = toStringOrNull(payload.batch_withdrawal_id);
  const hash = toStringOrNull(payload.hash);
  const error = toStringOrNull(payload.error);
  const updatedAt = toIsoDate(payload.updated_at) ?? new Date();
  const requestedAt = toIsoDate(payload.requested_at);
  const createdAt = toIsoDate(payload.created_at);

  const candidateUpdates: Record<string, unknown>[] = [
    {
      status: internalStatus,
      providerStatus,
      nowpaymentsPayoutId: payoutId,
      nowpaymentsBatchWithdrawalId: batchId,
      txid: hash,
      txHash: hash,
      payoutHash: hash,
      providerResponse: payload,
      lastWebhookPayload: payload,
      lastWebhookAt: new Date(),
      paidAt: internalStatus === "PAID" ? updatedAt : undefined,
      failedAt: internalStatus === "FAILED" ? updatedAt : undefined,
      requestedAt,
      createdAtProvider: createdAt,
      failureReason: internalStatus === "FAILED" ? error : undefined,
      providerError: error,
    },
    {
      payoutStatus: internalStatus,
      providerStatus,
      nowpaymentsPayoutId: payoutId,
      nowpaymentsBatchWithdrawalId: batchId,
      txid: hash,
      txHash: hash,
      providerResponse: payload,
      lastWebhookPayload: payload,
      lastWebhookAt: new Date(),
      paidAt: internalStatus === "PAID" ? updatedAt : undefined,
      failedAt: internalStatus === "FAILED" ? updatedAt : undefined,
      errorMessage: internalStatus === "FAILED" ? error : undefined,
    },
    {
      status: internalStatus,
      txid: hash,
      txHash: hash,
      updatedAt: new Date(),
    },
    {
      payoutStatus: internalStatus,
      updatedAt: new Date(),
    },
  ];

  for (const data of candidateUpdates) {
    try {
      return await model.update({
        where: { id: rowId },
        data,
      });
    } catch {
      // prueba payload más chico
    }
  }

  throw new Error("No se pudo actualizar el retiro con ningún payload compatible.");
}

async function safeCreateAudit(
  withdrawalId: string | null,
  payload: NowPaymentsPayoutIpn,
  providerStatus: string,
  internalStatus: "PAID" | "FAILED" | "PROCESSING",
  signature: string,
  rawBody: string
) {
  const auditModel = await getModel([
    "withdrawalAudit",
    "payoutAudit",
    "auditLog",
    "promoterWithdrawalAudit",
    "withdrawalEvent",
  ]);

  if (!auditModel) return;

  const candidateCreates: Record<string, unknown>[] = [
    {
      withdrawalId,
      action: "NOWPAYMENTS_IPN",
      status: internalStatus,
      provider: "NOWPAYMENTS",
      providerStatus,
      providerPayoutId: toStringOrNull(payload.id),
      providerBatchId: toStringOrNull(payload.batch_withdrawal_id),
      txid: toStringOrNull(payload.hash),
      message: toStringOrNull(payload.error),
      payload,
      rawBody,
      signature,
      createdAt: new Date(),
    },
    {
      withdrawalId,
      type: "NOWPAYMENTS_IPN",
      status: internalStatus,
      data: payload,
      createdAt: new Date(),
    },
    {
      entityId: withdrawalId,
      entityType: "WITHDRAWAL",
      action: "NOWPAYMENTS_IPN",
      payload,
      createdAt: new Date(),
    },
    {
      message: `NOWPAYMENTS_IPN ${providerStatus}`,
      payload,
      createdAt: new Date(),
    },
  ];

  for (const data of candidateCreates) {
    try {
      await auditModel.create({ data });
      return;
    } catch {
      // sigue sin romper
    }
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-nowpayments-sig") || "";
  const secret = process.env.NOWPAYMENTS_IPN_SECRET?.trim();

  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "NOWPAYMENTS_IPN_SECRET no configurado" },
      { status: 500 }
    );
  }

  if (!signature) {
    return NextResponse.json(
      { ok: false, error: "Firma x-nowpayments-sig ausente" },
      { status: 401 }
    );
  }

  let payload: NowPaymentsPayoutIpn;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body JSON inválido" },
      { status: 400 }
    );
  }

  const isValid = verifyNowPaymentsSignature(
    payload as Record<string, unknown>,
    signature,
    secret
  );

  if (!isValid) {
    return NextResponse.json(
      { ok: false, error: "Firma IPN inválida" },
      { status: 401 }
    );
  }

  const providerStatus = normalizeStatus(payload.status);
  const internalStatus = mapProviderStatusToInternal(providerStatus);

  try {
    const { model, row } = await findWithdrawalByProviderIds(payload);

    if (!model || !row) {
      await safeCreateAudit(
        null,
        payload,
        providerStatus,
        internalStatus,
        signature,
        rawBody
      );

      return NextResponse.json({
        ok: true,
        received: true,
        matched: false,
        providerStatus,
        internalStatus,
      });
    }

    const currentStatus = normalizeStatus((row as any).status || (row as any).payoutStatus);

    const alreadyFinal =
      currentStatus === "PAID" ||
      currentStatus === "FAILED";

    if (!alreadyFinal || internalStatus === "PAID" || internalStatus === "FAILED") {
      await prisma.$transaction(async () => {
        await safeUpdateWithdrawal(
          model,
          String((row as any).id),
          payload,
          providerStatus,
          internalStatus
        );

        await safeCreateAudit(
          String((row as any).id),
          payload,
          providerStatus,
          internalStatus,
          signature,
          rawBody
        );
      });
    } else {
      await safeCreateAudit(
        String((row as any).id),
        payload,
        providerStatus,
        internalStatus,
        signature,
        rawBody
      );
    }

    return NextResponse.json({
      ok: true,
      received: true,
      matched: true,
      withdrawalId: String((row as any).id),
      providerStatus,
      internalStatus,
    });
  } catch (error) {
    console.error("NOWPayments payout IPN error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Error procesando webhook de payout",
      },
      { status: 500 }
    );
  }
}