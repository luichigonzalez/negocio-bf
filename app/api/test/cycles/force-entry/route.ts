/* app/api/test/cycles/force-entry/route.ts */

import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { processCycleEntry } from "@/app/lib/cycles/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function toStr(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

async function findUserByEmail(email: string) {
  return prisma.user.findFirst({
    where: {
      email: {
        equals: email,
        mode: "insensitive",
      },
    },
  });
}

async function findPromoterProfileById(id: string) {
  return prisma.promoterProfile.findFirst({
    where: { id },
  });
}

async function findPromoterProfileByUserId(userId: string) {
  return prisma.promoterProfile.findFirst({
    where: { userId },
  });
}

async function findPromoterProfileByEmail(email: string) {
  const user = await findUserByEmail(email);
  if (!user) return null;

  return prisma.promoterProfile.findFirst({
    where: { userId: user.id },
  });
}

async function findPromoterProfileByReferralCode(referralCode: string) {
  const byProfile = await prisma.promoterProfile.findFirst({
    where: {
      referralCode: {
        equals: referralCode,
        mode: "insensitive",
      },
    },
  });

  if (byProfile) return byProfile;

  const user = await prisma.user.findFirst({
    where: {
      referralCode: {
        equals: referralCode,
        mode: "insensitive",
      },
    },
  });

  if (!user) return null;

  return prisma.promoterProfile.findFirst({
    where: { userId: user.id },
  });
}

async function createPromoterProfileFromUser(user: any) {
  const sponsorUserId = user?.referredById ? String(user.referredById) : null;

  let sponsorPromoterProfileId: string | null = null;

  if (user?.sponsorPromoterProfileId) {
    sponsorPromoterProfileId = String(user.sponsorPromoterProfileId);
  } else if (sponsorUserId) {
    const sponsorProfile = await prisma.promoterProfile.findFirst({
      where: { userId: sponsorUserId },
      select: { id: true },
    });

    sponsorPromoterProfileId = sponsorProfile?.id ?? null;
  }

  return prisma.promoterProfile.create({
    data: {
      userId: user.id,
      name: user.name ?? null,
      username: user.username ?? user.name ?? null,
      email: user.email ?? null,
      referralCode: user.referralCode ?? null,
      sponsorPromoterProfileId,
      membershipActive: false,
      membershipStatus: "PENDING",
      canAccessPanel: false,
      canEarn: false,
      isCycleUnlocked: false,
      cycleUnlocked: false,
      directReferralCount: 0,
      directReferralsCount: 0,
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
}

async function ensurePromoterProfile(params: {
  promoterProfileId?: string | null;
  userId?: string | null;
  email?: string | null;
  referralCode?: string | null;
}) {
  if (params.promoterProfileId) {
    const existing = await findPromoterProfileById(params.promoterProfileId);
    if (existing) return existing;
  }

  if (params.userId) {
    const existing = await findPromoterProfileByUserId(params.userId);
    if (existing) return existing;

    const user = await prisma.user.findFirst({
      where: { id: params.userId },
    });

    if (user) {
      return createPromoterProfileFromUser(user);
    }
  }

  if (params.email) {
    const existing = await findPromoterProfileByEmail(params.email);
    if (existing) return existing;

    const user = await findUserByEmail(params.email);

    if (user) {
      return createPromoterProfileFromUser(user);
    }
  }

  if (params.referralCode) {
    const existing = await findPromoterProfileByReferralCode(params.referralCode);
    if (existing) return existing;

    const user = await prisma.user.findFirst({
      where: {
        referralCode: {
          equals: params.referralCode,
          mode: "insensitive",
        },
      },
    });

    if (user) {
      return createPromoterProfileFromUser(user);
    }
  }

  return null;
}

async function ensureMembershipActive(promoterProfileId: string) {
  await prisma.promoterProfile.update({
    where: { id: promoterProfileId },
    data: {
      membershipActive: true,
      membershipStatus: "ACTIVE",
      canAccessPanel: true,
    },
  });
}

async function ensureSponsorLink(
  promoterProfileId: string,
  sponsorPromoterProfileId: string | null
) {
  if (!sponsorPromoterProfileId) return;

  await prisma.promoterProfile.update({
    where: { id: promoterProfileId },
    data: {
      sponsorPromoterProfileId,
    },
  });
}

async function ensureDirectReferral(
  sponsorPromoterProfileId: string,
  referredPromoterProfileId: string
) {
  const existing = await prisma.directReferral.findFirst({
    where: {
      sponsorPromoterProfileId,
      referredPromoterProfileId,
    },
  });

  if (!existing) {
    await prisma.directReferral.create({
      data: {
        sponsorPromoterProfileId,
        referredPromoterProfileId,
        status: "ACTIVE",
      },
    });
  }

  const totalDirects = await prisma.directReferral.count({
    where: {
      sponsorPromoterProfileId,
    },
  });

  await prisma.promoterProfile.update({
    where: { id: sponsorPromoterProfileId },
    data: {
      directReferralCount: totalDirects,
      directReferralsCount: totalDirects,
      isCycleUnlocked: totalDirects >= 2,
      cycleUnlocked: totalDirects >= 2,
      canEarn: totalDirects >= 2,
    },
  });

  return true;
}

async function resolveSponsorForPromoter(input: {
  explicitSponsorPromoterProfileId?: string | null;
  explicitSponsorUserId?: string | null;
  explicitSponsorEmail?: string | null;
  explicitSponsorReferralCode?: string | null;
  promoter: any;
}) {
  const {
    explicitSponsorPromoterProfileId,
    explicitSponsorUserId,
    explicitSponsorEmail,
    explicitSponsorReferralCode,
    promoter,
  } = input;

  if (explicitSponsorPromoterProfileId) {
    return await ensurePromoterProfile({
      promoterProfileId: explicitSponsorPromoterProfileId,
    });
  }

  if (explicitSponsorUserId) {
    return await ensurePromoterProfile({
      userId: explicitSponsorUserId,
    });
  }

  if (explicitSponsorEmail) {
    return await ensurePromoterProfile({
      email: explicitSponsorEmail,
    });
  }

  if (explicitSponsorReferralCode) {
    return await ensurePromoterProfile({
      referralCode: explicitSponsorReferralCode,
    });
  }

  if (promoter?.sponsorPromoterProfileId) {
    return await findPromoterProfileById(String(promoter.sponsorPromoterProfileId));
  }

  if (promoter?.userId) {
    const user = await prisma.user.findFirst({
      where: { id: String(promoter.userId) },
      select: {
        referredById: true,
        sponsorPromoterProfileId: true,
      },
    });

    if (user?.sponsorPromoterProfileId) {
      return await findPromoterProfileById(String(user.sponsorPromoterProfileId));
    }

    if (user?.referredById) {
      return await ensurePromoterProfile({
        userId: String(user.referredById),
      });
    }
  }

  return null;
}

async function runForceEntry(input: {
  promoterProfileId?: string | null;
  userId?: string | null;
  email?: string | null;
  referralCode?: string | null;
  sponsorPromoterProfileId?: string | null;
  sponsorUserId?: string | null;
  sponsorEmail?: string | null;
  sponsorReferralCode?: string | null;
}) {
  const promoter = await ensurePromoterProfile({
    promoterProfileId: toStr(input.promoterProfileId),
    userId: toStr(input.userId),
    email: toStr(input.email),
    referralCode: toStr(input.referralCode),
  });

  if (!promoter) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "No se encontró el usuario principal para crear/usar PromoterProfile.",
      },
      { status: 404 }
    );
  }

  const sponsor = await resolveSponsorForPromoter({
    explicitSponsorPromoterProfileId: toStr(input.sponsorPromoterProfileId),
    explicitSponsorUserId: toStr(input.sponsorUserId),
    explicitSponsorEmail: toStr(input.sponsorEmail),
    explicitSponsorReferralCode: toStr(input.sponsorReferralCode),
    promoter,
  });

  await ensureMembershipActive(promoter.id);

  if (sponsor && sponsor.id !== promoter.id) {
    await ensureSponsorLink(promoter.id, sponsor.id);
    await ensureDirectReferral(sponsor.id, promoter.id);
  }

  const result = await processCycleEntry({
    promoterProfileId: promoter.id,
    sponsorPromoterProfileId:
      sponsor && sponsor.id !== promoter.id ? sponsor.id : null,
  });

  const promoterUpdated = await prisma.promoterProfile.findUnique({
    where: { id: promoter.id },
    select: {
      id: true,
      userId: true,
      name: true,
      username: true,
      email: true,
      referralCode: true,
      sponsorPromoterProfileId: true,
      membershipActive: true,
      membershipStatus: true,
      directReferralCount: true,
      directReferralsCount: true,
      activeLevel: true,
      activeCycle: true,
      activeCycleLevel: true,
      activeCycleNumber: true,
      cycleLevel: true,
      cycleNumber: true,
      isCycleUnlocked: true,
      cycleUnlocked: true,
      canEarn: true,
    },
  });

  const sponsorUpdated = sponsor
    ? await prisma.promoterProfile.findUnique({
        where: { id: sponsor.id },
        select: {
          id: true,
          userId: true,
          name: true,
          username: true,
          email: true,
          referralCode: true,
          sponsorPromoterProfileId: true,
          membershipActive: true,
          membershipStatus: true,
          directReferralCount: true,
          directReferralsCount: true,
          activeLevel: true,
          activeCycle: true,
          activeCycleLevel: true,
          activeCycleNumber: true,
          cycleLevel: true,
          cycleNumber: true,
          isCycleUnlocked: true,
          cycleUnlocked: true,
          canEarn: true,
        },
      })
    : null;

  return NextResponse.json({
    ok: true,
    promoterProfileId: promoter.id,
    sponsorPromoterProfileId: sponsor?.id ?? null,
    cycleResult: result,
    promoter: promoterUpdated,
    sponsor: sponsorUpdated,
  });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    return await runForceEntry({
      promoterProfileId: toStr(searchParams.get("promoterProfileId")),
      userId: toStr(searchParams.get("userId")),
      email: toStr(searchParams.get("email")),
      referralCode: toStr(searchParams.get("referralCode")),
      sponsorPromoterProfileId: toStr(searchParams.get("sponsorPromoterProfileId")),
      sponsorUserId: toStr(searchParams.get("sponsorUserId")),
      sponsorEmail: toStr(searchParams.get("sponsorEmail")),
      sponsorReferralCode: toStr(searchParams.get("sponsorReferralCode")),
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Error forzando entrada al motor",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    return await runForceEntry({
      promoterProfileId: toStr(body.promoterProfileId),
      userId: toStr(body.userId),
      email: toStr(body.email),
      referralCode: toStr(body.referralCode),
      sponsorPromoterProfileId: toStr(body.sponsorPromoterProfileId),
      sponsorUserId: toStr(body.sponsorUserId),
      sponsorEmail: toStr(body.sponsorEmail),
      sponsorReferralCode: toStr(body.sponsorReferralCode),
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Error forzando entrada al motor",
      },
      { status: 500 }
    );
  }
}