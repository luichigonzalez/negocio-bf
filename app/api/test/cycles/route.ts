/* app/api/test/cycles/route.ts */

import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function toStr(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function toInt(value: unknown, fallback: number): number {
  if (value === null || value === undefined) return fallback;

  const raw = String(value).trim();
  if (!raw) return fallback;

  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function normalizeNode(node: any) {
  return {
    id: String(node.id),
    promoterProfileId: String(node.promoterProfileId),
    level: Number(node.level ?? 1),
    cycle: Number(node.cycle ?? 1),
    parentNodeId: node.parentNodeId ? String(node.parentNodeId) : null,
    status: String(node.status ?? "ACTIVE"),
    source: String(node.source ?? "DIRECT"),
    sponsoredByPromoterProfileId: node.sponsoredByPromoterProfileId
      ? String(node.sponsoredByPromoterProfileId)
      : null,
    createdAt: node.createdAt ? new Date(node.createdAt) : null,
  };
}

function buildFullTree(nodes: any[]) {
  const map = new Map<string, any>();

  for (const node of nodes) {
    map.set(node.id, {
      ...node,
      children: [],
    });
  }

  const roots: any[] = [];

  for (const node of nodes) {
    const current = map.get(node.id)!;

    if (node.parentNodeId && map.has(node.parentNodeId)) {
      map.get(node.parentNodeId)!.children.push(current);
    } else {
      roots.push(current);
    }
  }

  return { map, roots };
}

function extractSubtree(rootId: string, allNodes: any[]) {
  const byParent = new Map<string, any[]>();

  for (const node of allNodes) {
    if (!node.parentNodeId) continue;
    if (!byParent.has(node.parentNodeId)) byParent.set(node.parentNodeId, []);
    byParent.get(node.parentNodeId)!.push(node);
  }

  const allowedIds = new Set<string>();
  const queue = [rootId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    allowedIds.add(currentId);

    const children = byParent.get(currentId) || [];
    for (const child of children) {
      if (!allowedIds.has(child.id)) {
        queue.push(child.id);
      }
    }
  }

  return allNodes.filter((node) => allowedIds.has(node.id));
}

function countOccupiedFromRoot(allNodes: any[], rootId: string) {
  let count = 0;
  const byParent = new Map<string, any[]>();

  for (const node of allNodes) {
    if (!node.parentNodeId) continue;
    if (!byParent.has(node.parentNodeId)) byParent.set(node.parentNodeId, []);
    byParent.get(node.parentNodeId)!.push(node);
  }

  const queue = [...(byParent.get(rootId) || [])];

  while (queue.length > 0) {
    const current = queue.shift()!;
    count += 1;

    const children = byParent.get(current.id) || [];
    for (const child of children) {
      queue.push(child);
    }
  }

  return count;
}

async function resolvePromoterProfileId(params: {
  promoterProfileId?: string | null;
  userId?: string | null;
  email?: string | null;
}) {
  if (params.promoterProfileId) {
    const profile = await prisma.promoterProfile.findFirst({
      where: { id: params.promoterProfileId },
      select: { id: true },
    });

    if (profile?.id) return String(profile.id);
  }

  if (params.userId) {
    const profile = await prisma.promoterProfile.findFirst({
      where: { userId: params.userId },
      select: { id: true },
    });

    if (profile?.id) return String(profile.id);
  }

  if (params.email) {
    const user = await prisma.user.findFirst({
      where: {
        email: {
          equals: params.email,
          mode: "insensitive",
        },
      },
      select: { id: true },
    });

    if (user?.id) {
      const profile = await prisma.promoterProfile.findFirst({
        where: { userId: user.id },
        select: { id: true },
      });

      if (profile?.id) return String(profile.id);
    }
  }

  return null;
}

async function getPromoterSummary(promoterProfileId: string) {
  const promoter = await prisma.promoterProfile.findFirst({
    where: { id: promoterProfileId },
    select: {
      id: true,
      userId: true,
      username: true,
      email: true,
      sponsorPromoterProfileId: true,
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
      membershipActive: true,
      membershipStatus: true,
      walletBalance: true,
      earningsBalance: true,
      availableBalance: true,
      totalDirectEarnings: true,
      totalEarnings: true,
    },
  });

  if (!promoter) {
    throw new Error("Promotor no encontrado");
  }

  const activeLevel = Number(
    promoter.activeCycleLevel ??
      promoter.activeLevel ??
      promoter.cycleLevel ??
      1
  ) || 1;

  const activeCycle = Number(
    promoter.activeCycle ??
      promoter.activeCycleNumber ??
      promoter.cycleNumber ??
      1
  ) || 1;

  const directReferralCount = Number(
    promoter.directReferralCount ?? promoter.directReferralsCount ?? 0
  ) || 0;

  const isCycleUnlocked = Boolean(
    promoter.isCycleUnlocked ?? promoter.cycleUnlocked ?? promoter.canEarn ?? false
  );

  return {
    promoter: {
      id: String(promoter.id),
      userId: promoter.userId ? String(promoter.userId) : null,
      username: promoter.username ? String(promoter.username) : null,
      email: promoter.email ? String(promoter.email) : null,
      sponsorPromoterProfileId: promoter.sponsorPromoterProfileId
        ? String(promoter.sponsorPromoterProfileId)
        : null,
      directReferralCount,
      activeLevel,
      activeCycle,
      isCycleUnlocked,
      membershipActive: Boolean(promoter.membershipActive),
      membershipStatus: promoter.membershipStatus ?? null,
      walletBalance: Number(promoter.walletBalance ?? 0),
      earningsBalance: Number(promoter.earningsBalance ?? 0),
      availableBalance: Number(promoter.availableBalance ?? 0),
      totalDirectEarnings: Number(promoter.totalDirectEarnings ?? 0),
      totalEarnings: Number(promoter.totalEarnings ?? 0),
    },
    activeLevel,
    activeCycle,
  };
}

async function getAllCycleNodes(level: number, cycle: number) {
  const nodes = await prisma.cycleNode.findMany({
    where: {
      level,
      cycle,
    },
    orderBy: { createdAt: "asc" },
  });

  return (nodes || []).map(normalizeNode);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const promoterProfileId = toStr(searchParams.get("promoterProfileId"));
    const userId = toStr(searchParams.get("userId"));
    const email = toStr(searchParams.get("email"));

    const resolvedPromoterProfileId = await resolvePromoterProfileId({
      promoterProfileId,
      userId,
      email,
    });

    if (!resolvedPromoterProfileId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No se encontró promoterProfileId. Probá con promoterProfileId, userId o email.",
        },
        { status: 404 }
      );
    }

    const summaryData = await getPromoterSummary(resolvedPromoterProfileId);

    const level = toInt(searchParams.get("level"), summaryData.activeLevel || 1);
    const cycle = toInt(searchParams.get("cycle"), summaryData.activeCycle || 1);

    const allNodes = await getAllCycleNodes(level, cycle);

    const root = allNodes.find(
      (n) =>
        n.promoterProfileId === resolvedPromoterProfileId &&
        n.parentNodeId === null
    );

    const subtreeNodes = root ? extractSubtree(root.id, allNodes) : [];
    const occupied = root ? countOccupiedFromRoot(subtreeNodes, root.id) : 0;
    const required = 2;
    const completed = occupied >= required;

    const { roots } = buildFullTree(subtreeNodes);

    return NextResponse.json({
      ok: true,
      promoter: summaryData.promoter,
      requested: {
        level,
        cycle,
      },
      progress: {
        hasRoot: Boolean(root),
        rootNodeId: root?.id ?? null,
        occupied,
        required,
        completed,
      },
      totals: {
        nodes: subtreeNodes.length,
        roots: subtreeNodes.filter((n) => !n.parentNodeId).length,
      },
      flatNodes: subtreeNodes,
      tree: roots,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Error interno consultando motor de ciclos",
      },
      { status: 500 }
    );
  }
}