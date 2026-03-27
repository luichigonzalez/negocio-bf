import { prisma } from "@/app/lib/prisma";
import { processCycleEntry } from "@/app/lib/cycles/service";

const LICENSE_PRICE = 25;
const COMPANY_PERCENT = 25;
const DIRECT_COMMISSION = 18.75;

type OrderLike = {
  id: string;
  userId?: string | null;
  promoterProfileId?: string | null;
  amount?: number | string | null;
  status?: string | null;
  paymentStatus?: string | null;
  currency?: string | null;
  network?: string | null;
  externalPaymentId?: string | null;
  txHash?: string | null;
};

type ReleaseBlockedBalanceResult = {
  released: boolean;
  amount: number;
  reason: string | null;
};

function normalizeStatus(value: unknown) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function isPaidStatus(value: unknown) {
  const s = normalizeStatus(value);
  return (
    s === "PAID" ||
    s === "CONFIRMED" ||
    s === "FINISHED" ||
    s === "COMPLETED"
  );
}

function toNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function ensurePromoterProfile(userId: string, tx: any) {
  let profile = await tx.promoterProfile.findUnique({
    where: { userId },
  });

  if (profile) return profile;

  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      username: true,
      referralCode: true,
      referredById: true,
      sponsorPromoterProfileId: true,
    },
  });

  if (!user) {
    throw new Error("Usuario no encontrado para crear perfil promotor");
  }

  let sponsorPromoterProfileId: string | null = null;

  if (user.sponsorPromoterProfileId) {
    sponsorPromoterProfileId = String(user.sponsorPromoterProfileId);
  } else if (user.referredById) {
    const sponsorUserProfile = await tx.promoterProfile.findUnique({
      where: { userId: String(user.referredById) },
      select: { id: true },
    });

    sponsorPromoterProfileId = sponsorUserProfile?.id ?? null;
  }

  profile = await tx.promoterProfile.create({
    data: {
      userId: user.id,
      email: user.email ?? null,
      username: user.username ?? null,
      referralCode: user.referralCode ?? null,
      sponsorPromoterProfileId,
      membershipActive: true,
      membershipStatus: "ACTIVE",
      canAccessPanel: true,
      canEarn: false,
      isCycleUnlocked: false,
      directReferralCount: 0,
      activeLevel: 1,
      activeCycle: 1,
      activeCycleLevel: 1,
      activeCycleNumber: 1,
      cycleLevel: 1,
      cycleNumber: 1,
      walletBalance: 0,
      earningsBalance: 0,
      availableBalance: 0,
      totalDirectEarnings: 0,
      totalEarnings: 0,
      totalWithdrawn: 0,
    },
  });

  return profile;
}

async function getPromoterDirectCount(promoterProfileId: string, tx: any) {
  const promoter = await tx.promoterProfile.findUnique({
    where: { id: promoterProfileId },
    select: {
      id: true,
      userId: true,
      directReferralCount: true,
      directReferralsCount: true,
      isCycleUnlocked: true,
      cycleUnlocked: true,
      canEarn: true,
    },
  });

  if (!promoter) return null;

  const directCount =
    Number(promoter.directReferralCount ?? promoter.directReferralsCount ?? 0) || 0;

  return {
    ...promoter,
    directCount,
  };
}

async function unlockPromoterIfQualified(promoterProfileId: string, tx: any) {
  const promoter = await getPromoterDirectCount(promoterProfileId, tx);

  if (!promoter) return null;

  const shouldUnlock = promoter.directCount >= 2;

  if (!shouldUnlock) {
    return promoter;
  }

  await tx.promoterProfile.update({
    where: { id: promoterProfileId },
    data: {
      isCycleUnlocked: true,
      cycleUnlocked: true,
      canEarn: true,
    },
  });

  return promoter;
}

async function releaseBlockedBalanceIfQualified(
  promoterProfileId: string,
  tx: any
): Promise<ReleaseBlockedBalanceResult> {
  const promoter = await getPromoterDirectCount(promoterProfileId, tx);

  if (!promoter?.userId) {
    return {
      released: false,
      amount: 0,
      reason: "PROMOTER_NOT_FOUND",
    };
  }

  if (promoter.directCount < 2) {
    return {
      released: false,
      amount: 0,
      reason: "NOT_QUALIFIED",
    };
  }

  const user = await tx.user.findUnique({
    where: { id: String(promoter.userId) },
    select: {
      id: true,
      lockedBalance: true,
    },
  });

  if (!user) {
    return {
      released: false,
      amount: 0,
      reason: "USER_NOT_FOUND",
    };
  }

  const blockedAmount = toNumber(user.lockedBalance, 0);

  if (blockedAmount <= 0) {
    return {
      released: false,
      amount: 0,
      reason: "NO_BLOCKED_BALANCE",
    };
  }

  await tx.user.update({
    where: { id: user.id },
    data: {
      lockedBalance: 0,
    },
  });

  await tx.promoterProfile.update({
    where: { id: promoterProfileId },
    data: {
      availableBalance: { increment: blockedAmount },
    },
  });

  return {
    released: true,
    amount: blockedAmount,
    reason: null,
  };
}

async function sumDirectCommissionToSponsor(
  sponsorPromoterProfileId: string,
  buyerPromoterProfileId: string,
  orderId: string,
  tx: any
) {
  const existing = await tx.walletMovement.findFirst({
    where: {
      promoterProfileId: sponsorPromoterProfileId,
      type: "DIRECT_COMMISSION",
      referenceId: orderId,
    },
  });

  if (existing) {
    return existing;
  }

  const sponsorProfile = await tx.promoterProfile.findUnique({
    where: { id: sponsorPromoterProfileId },
    select: {
      id: true,
      userId: true,
    },
  });

  if (!sponsorProfile?.userId) {
    throw new Error("Sponsor sin userId para bloquear comisión");
  }

  const movement = await tx.walletMovement.create({
    data: {
      promoterProfileId: sponsorPromoterProfileId,
      type: "DIRECT_COMMISSION",
      amount: DIRECT_COMMISSION,
      currency: "USDT",
      status: "COMPLETED",
      description: "Comisión directa por activación de licencia",
      referenceId: orderId,
      meta: {
        buyerPromoterProfileId,
        grossLicense: LICENSE_PRICE,
        companyPercent: COMPANY_PERCENT,
        directCommission: DIRECT_COMMISSION,
        releaseRule: "Se libera al completar 2 directos activos",
      },
    },
  });

  await tx.promoterProfile.update({
    where: { id: sponsorPromoterProfileId },
    data: {
      walletBalance: { increment: DIRECT_COMMISSION },
      earningsBalance: { increment: DIRECT_COMMISSION },
      totalDirectEarnings: { increment: DIRECT_COMMISSION },
      totalEarnings: { increment: DIRECT_COMMISSION },
    },
  });

  await tx.user.update({
    where: { id: String(sponsorProfile.userId) },
    data: {
      lockedBalance: { increment: DIRECT_COMMISSION },
    },
  });

  return movement;
}

async function incrementDirectReferralToSponsor(
  sponsorPromoterProfileId: string,
  buyerPromoterProfileId: string,
  tx: any
) {
  const existing = await tx.directReferral.findFirst({
    where: {
      sponsorPromoterProfileId,
      referredPromoterProfileId: buyerPromoterProfileId,
    },
  });

  if (existing) {
    return existing;
  }

  const referral = await tx.directReferral.create({
    data: {
      sponsorPromoterProfileId,
      referredPromoterProfileId: buyerPromoterProfileId,
      status: "ACTIVE",
    },
  });

  const sponsor = await tx.promoterProfile.findUnique({
    where: { id: sponsorPromoterProfileId },
    select: {
      directReferralCount: true,
      directReferralsCount: true,
    },
  });

  const currentDirectCount =
    Number(sponsor?.directReferralCount ?? sponsor?.directReferralsCount ?? 0) || 0;

  await tx.promoterProfile.update({
    where: { id: sponsorPromoterProfileId },
    data: {
      directReferralCount: currentDirectCount + 1,
      directReferralsCount: currentDirectCount + 1,
    },
  });

  return referral;
}

async function activateMembership(promoterProfileId: string, orderId: string, tx: any) {
  await tx.promoterProfile.update({
    where: { id: promoterProfileId },
    data: {
      membershipActive: true,
      membershipStatus: "ACTIVE",
      canAccessPanel: true,
      activatedAt: new Date(),
      licenseActivatedAt: new Date(),
      lastOrderId: orderId,
    },
  });
}

async function markOrderConfirmed(
  orderId: string,
  externalPaymentId: string | null,
  txHash: string | null,
  tx: any
) {
  return await tx.promoterOrder.update({
    where: { id: orderId },
    data: {
      status: "CONFIRMED",
      paymentStatus: "PAID",
      paidAt: new Date(),
      externalPaymentId: externalPaymentId || undefined,
      txHash: txHash || undefined,
    },
  });
}

export async function processPromoterOrderConfirmation(params: {
  orderId: string;
  txHash?: string | null;
  externalPaymentId?: string | null;
}) {
  const { orderId, txHash = null, externalPaymentId = null } = params;

  if (!orderId) {
    throw new Error("orderId es obligatorio");
  }

  return await prisma.$transaction(async (tx: any) => {
    const order: OrderLike | null = await tx.promoterOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        userId: true,
        promoterProfileId: true,
        amount: true,
        status: true,
        paymentStatus: true,
        currency: true,
        network: true,
        externalPaymentId: true,
        txHash: true,
      },
    });

    if (!order) {
      throw new Error("Orden no encontrada");
    }

    if (isPaidStatus(order.status) || isPaidStatus(order.paymentStatus)) {
      const alreadyProcessedProfileId = order.promoterProfileId
        ? String(order.promoterProfileId)
        : null;

      return {
        ok: true,
        alreadyProcessed: true,
        orderId: order.id,
        promoterProfileId: alreadyProcessedProfileId,
      };
    }

    const userId = order.userId ? String(order.userId) : null;

    if (!userId) {
      throw new Error("La orden no tiene userId");
    }

    const buyerProfile = await ensurePromoterProfile(userId, tx);

    await activateMembership(buyerProfile.id, order.id, tx);

    const refreshedBuyer = await tx.promoterProfile.findUnique({
      where: { id: buyerProfile.id },
      select: {
        id: true,
        sponsorPromoterProfileId: true,
        membershipActive: true,
      },
    });

    if (!refreshedBuyer) {
      throw new Error("No se pudo refrescar el perfil comprador");
    }

    const sponsorPromoterProfileId = refreshedBuyer.sponsorPromoterProfileId
      ? String(refreshedBuyer.sponsorPromoterProfileId)
      : null;

    await markOrderConfirmed(order.id, externalPaymentId, txHash, tx);

    await tx.promoterOrder.update({
      where: { id: order.id },
      data: {
        promoterProfileId: refreshedBuyer.id,
        amount: toNumber(order.amount, LICENSE_PRICE),
        netAmount: DIRECT_COMMISSION,
        currency: String(order.currency || "USDT"),
        network: String(order.network || "TRC20"),
      },
    });

    let directReferralCreated = null;
    let directCommissionMovement = null;
    let releasedBlockedBalance: ReleaseBlockedBalanceResult = {
      released: false,
      amount: 0,
      reason: "NO_SPONSOR",
    };

    if (sponsorPromoterProfileId && sponsorPromoterProfileId !== refreshedBuyer.id) {
      directReferralCreated = await incrementDirectReferralToSponsor(
        sponsorPromoterProfileId,
        refreshedBuyer.id,
        tx
      );

      directCommissionMovement = await sumDirectCommissionToSponsor(
        sponsorPromoterProfileId,
        refreshedBuyer.id,
        order.id,
        tx
      );

      await tx.promoterProfile.update({
        where: { id: refreshedBuyer.id },
        data: {
          sponsorPromoterProfileId,
        },
      });

      await unlockPromoterIfQualified(sponsorPromoterProfileId, tx);

      releasedBlockedBalance = await releaseBlockedBalanceIfQualified(
        sponsorPromoterProfileId,
        tx
      );
    }

    const cycleResult = await processCycleEntry(
      {
        promoterProfileId: refreshedBuyer.id,
        sponsorPromoterProfileId,
      },
      tx
    );

    let sponsorCycleResult = null;

    if (sponsorPromoterProfileId) {
      sponsorCycleResult = await processCycleEntry(
        {
          promoterProfileId: sponsorPromoterProfileId,
          sponsorPromoterProfileId: null,
        },
        tx
      );
    }

    await tx.promoterOrder.update({
      where: { id: order.id },
      data: {
        cycleProcessedAt: new Date(),
        cyclePlacementStatus: cycleResult?.ok ? "PLACED" : "PENDING",
        cyclePlacementMeta: {
          buyerResult: cycleResult,
          sponsorResult: sponsorCycleResult,
          blockedBalanceRelease: releasedBlockedBalance,
        },
      },
    });

    return {
      ok: true,
      orderId: order.id,
      promoterProfileId: refreshedBuyer.id,
      sponsorPromoterProfileId,
      directReferralCreated: Boolean(directReferralCreated),
      directCommissionApplied: Boolean(directCommissionMovement),
      blockedBalanceRelease: releasedBlockedBalance,
      cycleResult,
      sponsorCycleResult,
    };
  });
}