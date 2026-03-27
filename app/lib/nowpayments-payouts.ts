// app/lib/nowpayments-payouts.ts

const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY!;
const NOWPAYMENTS_PAYOUT_URL =
  process.env.NOWPAYMENTS_PAYOUT_URL || "https://api.nowpayments.io/v1/payout";

type CreatePayoutParams = {
  address: string;
  amount: number;
  currency: "usdttrc20";
  ipn_callback_url?: string;
  extra_id?: string;
};

export type PayoutResponse = {
  id: string;
  status: string;
  batch_withdrawal_id?: string;
  error?: string;
  raw?: any;
};

// 👉 crear payout individual
export async function createPayout({
  address,
  amount,
  currency,
  ipn_callback_url,
  extra_id,
}: CreatePayoutParams): Promise<PayoutResponse> {
  try {
    const body = {
      withdrawals: [
        {
          address,
          currency,
          amount,
          ipn_callback_url,
          extra_id,
        },
      ],
    };

    const res = await fetch(NOWPAYMENTS_PAYOUT_URL, {
      method: "POST",
      headers: {
        "x-api-key": NOWPAYMENTS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      return {
        id: "",
        status: "FAILED",
        error: data?.message || "Error en NOWPayments",
        raw: data,
      };
    }

    const withdrawal = data?.withdrawals?.[0];

    return {
      id: withdrawal?.id,
      status: withdrawal?.status || "PROCESSING",
      batch_withdrawal_id: data?.batch_withdrawal_id,
      raw: data,
    };
  } catch (error: any) {
    return {
      id: "",
      status: "FAILED",
      error: error.message,
    };
  }
}

// 👉 consultar estado payout
export async function getPayoutStatus(withdrawalId: string) {
  try {
    const res = await fetch(
      `${NOWPAYMENTS_PAYOUT_URL}/${withdrawalId}`,
      {
        method: "GET",
        headers: {
          "x-api-key": NOWPAYMENTS_API_KEY,
        },
      }
    );

    const data = await res.json();

    if (!res.ok) {
      return {
        ok: false,
        error: data?.message || "Error consultando payout",
      };
    }

    return {
      ok: true,
      status: data?.status,
      raw: data,
    };
  } catch (error: any) {
    return {
      ok: false,
      error: error.message,
    };
  }
}

// 👉 cancelar payout (si aplica)
export async function cancelPayout(withdrawalId: string) {
  try {
    const res = await fetch(
      `${NOWPAYMENTS_PAYOUT_URL}/${withdrawalId}/cancel`,
      {
        method: "POST",
        headers: {
          "x-api-key": NOWPAYMENTS_API_KEY,
        },
      }
    );

    const data = await res.json();

    if (!res.ok) {
      return {
        ok: false,
        error: data?.message || "Error cancelando payout",
      };
    }

    return {
      ok: true,
      status: data?.status,
      raw: data,
    };
  } catch (error: any) {
    return {
      ok: false,
      error: error.message,
    };
  }
}

// 👉 normalizar estados
export function mapNowPaymentsStatus(status: string) {
  switch (status?.toLowerCase()) {
    case "finished":
    case "completed":
    case "confirmed":
      return "PAID";

    case "waiting":
    case "processing":
    case "sending":
      return "PROCESSING";

    case "failed":
    case "rejected":
    case "expired":
      return "FAILED";

    default:
      return "PROCESSING";
  }
}