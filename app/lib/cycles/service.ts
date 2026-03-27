import { prisma } from "@/app/lib/prisma";
import {
  CycleNode,
  CyclePositionInput,
  PlacementResult,
  PromoterCycleSummary,
  PositionSource,
  MAX_CYCLES_PER_LEVEL,
  MAX_LEVELS,
  createRootCycleNode,
  getNextLevelCycle,
  isPromoterUnlocked,
  placePromoterInCycle,
  shouldCreateInitialCycleRoot,
} from "@/app/lib/cycles/motor";

type PrismaTx = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

function db(tx?: PrismaTx) {
  return (tx || prisma) as any;
}

function toNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeCycleNodeStatus(value: unknown): CycleNode["status"] {
  const status = String(value || "").trim().toUpperCase();

  if (
    status === "ACTIVE" ||
    status === "COMPLETED" ||
    status === "REINVESTED" ||
    status === "CLOSED"
  ) {
    return status as CycleNode["status"];
  }

  return "ACTIVE";
}

function normalizePositionSource(value: unknown): PositionSource {
  const source = String(value || "").trim().toUpperCase();

  if (
    source === "DIRECT" ||
    source === "SPILLOVER" ||
    source === "REINVEST"
  ) {
    return source as PositionSource;
  }

  return "DIRECT";
}

function normalizeCycleNode(node: any): CycleNode {
  return {
    id: String(node.id),
    promoterProfileId: String(node.promoterProfileId),
    level: Number(node.level),
    cycle: Number(node.cycle),
    parentNodeId: node.parentNodeId ? String(node.parentNodeId) : null,
    status: normalizeCycleNodeStatus(node.status),
    source: normalizePositionSource(node.source),
    sponsoredByPromoterProfileId: node.sponsoredByPromoterProfileId
      ? String(node.sponsoredByPromoterProfileId)
      : null,
    createdAt: node.createdAt ? new Date(node.createdAt) : new Date(),
  };
}

export async function getPromoterCycleSummary(
  promoterProfileId: string,
  tx?: PrismaTx
): Promise<PromoterCycleSummary> {
  const database = db(tx);

  const promoter = await database.promoterProfile.findUnique({
    where: { id: promoterProfileId },
    select: {
      id: true,
      directReferralCount: true,
      directReferralsCount: true,
      activeCycleLevel: true,
      activeLevel: true,
      cycleLevel: true,
      activeCycle: true,
      activeCycleNumber: true,
      cycleNumber: true,
      cycleUnlocked: true,
      isCycleUnlocked: true,
      canEarn: true,
    },
  });

  if (!promoter) {
    throw new Error("Promotor no encontrado");
  }

  const directCount =
    toNumber(promoter.directReferralCount, -1) >= 0
      ? toNumber(promoter.directReferralCount)
      : toNumber(promoter.directReferralsCount);

  const activeLevel =
    toNumber(promoter.activeCycleLevel, -1) >= 0
      ? toNumber(promoter.activeCycleLevel)
      : toNumber(promoter.activeLevel, -1) >= 0
        ? toNumber(promoter.activeLevel)
        : toNumber(promoter.cycleLevel, 1);

  const activeCycle =
    toNumber(promoter.activeCycle, -1) >= 0
      ? toNumber(promoter.activeCycle)
      : toNumber(promoter.activeCycleNumber, -1) >= 0
        ? toNumber(promoter.activeCycleNumber)
        : toNumber(promoter.cycleNumber, 1);

  const unlocked =
    Boolean(promoter.cycleUnlocked) ||
    Boolean(promoter.isCycleUnlocked) ||
    Boolean(promoter.canEarn) ||
    directCount >= 2;

  return {
    promoterProfileId: String(promoter.id),
    directCount,
    activeLevel: activeLevel || 1,
    activeCycle: activeCycle || 1,
    isUnlocked: unlocked,
  };
}

export async function getAllCycleNodesByLevelCycle(
  level: number,
  cycle: number,
  tx?: PrismaTx
): Promise<CycleNode[]> {
  const database = db(tx);

  const nodes = await database.cycleNode.findMany({
    where: {
      level,
      cycle,
      status: {
        in: ["ACTIVE", "COMPLETED", "REINVESTED", "CLOSED"],
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return nodes.map(normalizeCycleNode);
}

async function getActiveRootByLevelCycle(params: {
  promoterProfileId: string;
  level: number;
  cycle: number;
  tx?: PrismaTx;
}) {
  const database = db(params.tx);

  return database.cycleNode.findFirst({
    where: {
      promoterProfileId: params.promoterProfileId,
      level: params.level,
      cycle: params.cycle,
      parentNodeId: null,
      status: "ACTIVE",
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function createCycleRootIfMissing(
  promoterProfileId: string,
  tx?: PrismaTx,
  source: PositionSource = "DIRECT"
) {
  const database = db(tx);
  const summary = await getPromoterCycleSummary(promoterProfileId, tx);

  const currentNodes = await getAllCycleNodesByLevelCycle(
    summary.activeLevel,
    summary.activeCycle,
    tx
  );

  if (
    !shouldCreateInitialCycleRoot(
      currentNodes,
      promoterProfileId,
      summary.activeLevel,
      summary.activeCycle
    )
  ) {
    return null;
  }

  const rootInput = createRootCycleNode({
    promoterProfileId,
    level: summary.activeLevel,
    cycle: summary.activeCycle,
    source,
    sponsoredByPromoterProfileId: null,
  });

  return await database.cycleNode.create({
    data: {
      promoterProfileId: rootInput.promoterProfileId,
      level: summary.activeLevel,
      cycle: summary.activeCycle,
      parentNodeId: null,
      status: "ACTIVE",
      source: rootInput.source,
      sponsoredByPromoterProfileId: rootInput.sponsoredByPromoterProfileId,
    },
  });
}

export async function ensurePromoterHasActiveRoot(
  promoterProfileId: string,
  tx?: PrismaTx
) {
  await createCycleRootIfMissing(promoterProfileId, tx, "DIRECT");
}

async function createCyclePlacementNode(
  input: CyclePositionInput,
  level: number,
  cycle: number,
  tx?: PrismaTx
) {
  const database = db(tx);

  return await database.cycleNode.create({
    data: {
      promoterProfileId: input.promoterProfileId,
      level,
      cycle,
      parentNodeId: input.parentNodeId,
      status: "ACTIVE",
      source: input.source,
      sponsoredByPromoterProfileId: input.sponsoredByPromoterProfileId,
    },
  });
}

async function markNodesStatus(
  nodeIds: string[],
  status: "COMPLETED" | "REINVESTED" | "CLOSED",
  tx?: PrismaTx
) {
  if (!nodeIds.length) return;

  const database = db(tx);

  await database.cycleNode.updateMany({
    where: { id: { in: nodeIds } },
    data: { status },
  });
}

async function advancePromoterCyclePosition(
  promoterProfileId: string,
  currentLevel: number,
  currentCycle: number,
  tx?: PrismaTx
) {
  const database = db(tx);
  const next = getNextLevelCycle(currentLevel, currentCycle);

  await database.promoterProfile.update({
    where: { id: promoterProfileId },
    data: {
      activeCycleLevel: next.nextLevel,
      activeLevel: next.nextLevel,
      cycleLevel: next.nextLevel,
      activeCycle: next.nextCycle,
      activeCycleNumber: next.nextCycle,
      cycleNumber: next.nextCycle,
      ...(next.closesBusiness ? { completedLevel10At: new Date() } : {}),
    },
  });

  return next;
}

async function createAdvancedOwnerRoots(
  ownerPromoterProfileId: string,
  totalRootsToCreate: number,
  tx?: PrismaTx
) {
  if (totalRootsToCreate <= 0) return [];

  const created: any[] = [];

  for (let i = 0; i < totalRootsToCreate; i += 1) {
    const summary = await getPromoterCycleSummary(ownerPromoterProfileId, tx);

    const existingRoot = await db(tx).cycleNode.findFirst({
      where: {
        promoterProfileId: ownerPromoterProfileId,
        level: summary.activeLevel,
        cycle: summary.activeCycle,
        parentNodeId: null,
        status: "ACTIVE",
      },
    });

    if (existingRoot) {
      created.push(existingRoot);
      continue;
    }

    const root = await db(tx).cycleNode.create({
      data: {
        promoterProfileId: ownerPromoterProfileId,
        level: summary.activeLevel,
        cycle: summary.activeCycle,
        parentNodeId: null,
        status: "ACTIVE",
        source: "REINVEST",
        sponsoredByPromoterProfileId: null,
      },
    });

    created.push(root);
  }

  return created;
}

async function getSponsorChain(startPromoterProfileId: string, tx?: PrismaTx) {
  const database = db(tx);
  const chain: string[] = [];

  let currentId: string | null = startPromoterProfileId;
  const visited = new Set<string>();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);

    const sponsorRow = (await database.promoterProfile.findUnique({
      where: { id: currentId },
      select: {
        id: true,
        sponsorPromoterProfileId: true,
      },
    })) as { id: string; sponsorPromoterProfileId: string | null } | null;

    if (!sponsorRow?.sponsorPromoterProfileId) break;

    chain.push(String(sponsorRow.sponsorPromoterProfileId));
    currentId = String(sponsorRow.sponsorPromoterProfileId);
  }

  return chain;
}

async function placePromoterInSpecificLevelCycle(params: {
  promoterProfileId: string;
  uplinePromoterProfileId: string;
  level: number;
  cycle: number;
  sponsoredByPromoterProfileId?: string | null;
  source?: PositionSource;
  tx?: PrismaTx;
}) {
  const source = params.source || "SPILLOVER";
  const sponsoredByPromoterProfileId = params.sponsoredByPromoterProfileId || null;

  const uplineSummary = await getPromoterCycleSummary(
    params.uplinePromoterProfileId,
    params.tx
  );

  if (!isPromoterUnlocked(uplineSummary)) {
    return {
      ok: false,
      reason: "UPLINE_LOCKED",
    };
  }

  const existingRoot = await getActiveRootByLevelCycle({
    promoterProfileId: params.uplinePromoterProfileId,
    level: params.level,
    cycle: params.cycle,
    tx: params.tx,
  });

  if (!existingRoot) {
    return {
      ok: false,
      reason: "UPLINE_LEVEL_ROOT_NOT_FOUND",
    };
  }

  const allNodes = await getAllCycleNodesByLevelCycle(
    params.level,
    params.cycle,
    params.tx
  );

  const promoterSummary: PromoterCycleSummary = {
    promoterProfileId: params.promoterProfileId,
    directCount: 0,
    activeLevel: params.level,
    activeCycle: params.cycle,
    isUnlocked: true,
  };

  const scopedUplineSummary: PromoterCycleSummary = {
    promoterProfileId: params.uplinePromoterProfileId,
    directCount: uplineSummary.directCount,
    activeLevel: params.level,
    activeCycle: params.cycle,
    isUnlocked: uplineSummary.isUnlocked,
  };

  const placement = placePromoterInCycle({
    promoterSummary,
    uplineSummary: scopedUplineSummary,
    allNodes,
    sponsoredByPromoterProfileId,
    source,
  });

  if (!placement.placed) {
    return {
      ok: false,
      reason: placement.reason,
    };
  }

  for (const nodeInput of placement.createdNodes) {
    await createCyclePlacementNode(nodeInput, params.level, params.cycle, params.tx);
  }

  return {
    ok: true,
    reason: null,
    targetNodeId: placement.targetNodeId,
    createdNodes: placement.createdNodes,
  };
}

async function propagateLevelEntryToUplines(params: {
  promotedPromoterProfileId: string;
  level: number;
  cycle: number;
  immediateSponsorPromoterProfileId?: string | null;
  tx?: PrismaTx;
}) {
  const chain = params.immediateSponsorPromoterProfileId
    ? [
        params.immediateSponsorPromoterProfileId,
        ...(await getSponsorChain(
          params.immediateSponsorPromoterProfileId,
          params.tx
        )),
      ]
    : await getSponsorChain(params.promotedPromoterProfileId, params.tx);

  const uniqueChain = [...new Set(chain.filter(Boolean))] as string[];

  for (const uplineId of uniqueChain) {
    const uplineSummary = await getPromoterCycleSummary(uplineId, params.tx);

    if (!isPromoterUnlocked(uplineSummary)) {
      continue;
    }

    const uplineRoot = await getActiveRootByLevelCycle({
      promoterProfileId: uplineId,
      level: params.level,
      cycle: params.cycle,
      tx: params.tx,
    });

    if (!uplineRoot) {
      continue;
    }

    const alreadyLinked = await db(params.tx).cycleNode.findFirst({
      where: {
        promoterProfileId: params.promotedPromoterProfileId,
        level: params.level,
        cycle: params.cycle,
        sponsoredByPromoterProfileId: uplineId,
      },
      select: { id: true },
    });

    if (alreadyLinked) {
      continue;
    }

    const placed = await placePromoterInSpecificLevelCycle({
      promoterProfileId: params.promotedPromoterProfileId,
      uplinePromoterProfileId: uplineId,
      level: params.level,
      cycle: params.cycle,
      sponsoredByPromoterProfileId: uplineId,
      source: "SPILLOVER",
      tx: params.tx,
    });

    if (placed.ok) {
      break;
    }
  }
}

async function applyPlacementResult(
  placement: PlacementResult,
  ownerSummary: PromoterCycleSummary,
  sponsoredByPromoterProfileId: string | null,
  tx?: PrismaTx
) {
  if (!placement.placed) {
    return placement;
  }

  const ownerLevel = ownerSummary.activeLevel;
  const ownerCycle = ownerSummary.activeCycle;

  for (const nodeInput of placement.createdNodes) {
    await createCyclePlacementNode(nodeInput, ownerLevel, ownerCycle, tx);
  }

  if (placement.completedNodeIds.length) {
    await markNodesStatus(placement.completedNodeIds, "COMPLETED", tx);

    const next = await advancePromoterCyclePosition(
      ownerSummary.promoterProfileId,
      ownerLevel,
      ownerCycle,
      tx
    );

    if (placement.reinvestedNodeIds.length) {
      await markNodesStatus(placement.reinvestedNodeIds, "REINVESTED", tx);
    }

    if (placement.closedNodeIds.length) {
      await markNodesStatus(placement.closedNodeIds, "CLOSED", tx);
    }

    let rootsToCreate = 1;

    if (ownerCycle === MAX_CYCLES_PER_LEVEL && ownerLevel < MAX_LEVELS) {
      rootsToCreate = 1;
    }

    if (ownerLevel === MAX_LEVELS && ownerCycle === MAX_CYCLES_PER_LEVEL) {
      rootsToCreate = 1;
    }

    await createAdvancedOwnerRoots(ownerSummary.promoterProfileId, rootsToCreate, tx);
    await createCycleRootIfMissing(ownerSummary.promoterProfileId, tx, "REINVEST");

    await propagateLevelEntryToUplines({
      promotedPromoterProfileId: ownerSummary.promoterProfileId,
      level: next.nextLevel,
      cycle: next.nextCycle,
      immediateSponsorPromoterProfileId: sponsoredByPromoterProfileId,
      tx,
    });

    return {
      ...placement,
      nextLevel: next.nextLevel,
      nextCycle: next.nextCycle,
    };
  }

  return placement;
}

async function placePromoterUnderUplineInternal(
  params: {
    promoterProfileId: string;
    uplinePromoterProfileId: string;
    sponsoredByPromoterProfileId?: string | null;
    source?: PositionSource;
  },
  tx: PrismaTx
) {
  const source = params.source || "SPILLOVER";
  const sponsoredByPromoterProfileId = params.sponsoredByPromoterProfileId || null;

  await ensurePromoterHasActiveRoot(params.promoterProfileId, tx);
  await ensurePromoterHasActiveRoot(params.uplinePromoterProfileId, tx);

  const promoterSummary = await getPromoterCycleSummary(params.promoterProfileId, tx);
  const uplineSummary = await getPromoterCycleSummary(params.uplinePromoterProfileId, tx);

  if (!isPromoterUnlocked(uplineSummary)) {
    return {
      ok: false,
      reason: "UPLINE_LOCKED",
    };
  }

  const allNodes = await getAllCycleNodesByLevelCycle(
    uplineSummary.activeLevel,
    uplineSummary.activeCycle,
    tx
  );

  const placement = placePromoterInCycle({
    promoterSummary,
    uplineSummary,
    allNodes,
    sponsoredByPromoterProfileId,
    source,
  });

  const applied = await applyPlacementResult(
    placement,
    uplineSummary,
    sponsoredByPromoterProfileId,
    tx
  );

  return {
    ok: Boolean(applied.placed),
    reason: applied.reason,
    targetNodeId: applied.targetNodeId,
    createdNodes: applied.createdNodes,
    completedNodeIds: applied.completedNodeIds,
    reinvestedNodeIds: applied.reinvestedNodeIds,
    closedNodeIds: applied.closedNodeIds,
    nextLevel: (applied as any).nextLevel ?? null,
    nextCycle: (applied as any).nextCycle ?? null,
  };
}

export async function placePromoterUnderUpline(
  params: {
    promoterProfileId: string;
    uplinePromoterProfileId: string;
    sponsoredByPromoterProfileId?: string | null;
    source?: PositionSource;
  },
  tx?: PrismaTx
) {
  if (tx) {
    return await placePromoterUnderUplineInternal(params, tx);
  }

  return await prisma.$transaction(async (innerTx: PrismaTx) => {
    return await placePromoterUnderUplineInternal(params, innerTx);
  });
}

async function processCycleEntryInternal(
  params: {
    promoterProfileId: string;
    sponsorPromoterProfileId: string | null;
  },
  tx: PrismaTx
) {
  await ensurePromoterHasActiveRoot(params.promoterProfileId, tx);

  if (!params.sponsorPromoterProfileId) {
    return {
      ok: true,
      mode: "NO_SPONSOR",
    };
  }

  await ensurePromoterHasActiveRoot(params.sponsorPromoterProfileId, tx);

  return await placePromoterUnderUplineInternal(
    {
      promoterProfileId: params.promoterProfileId,
      uplinePromoterProfileId: params.sponsorPromoterProfileId,
      sponsoredByPromoterProfileId: params.sponsorPromoterProfileId,
      source: "DIRECT",
    },
    tx
  );
}

export async function processCycleEntry(
  params: {
    promoterProfileId: string;
    sponsorPromoterProfileId: string | null;
  },
  tx?: PrismaTx
) {
  if (tx) {
    return await processCycleEntryInternal(params, tx);
  }

  return await prisma.$transaction(async (innerTx: PrismaTx) => {
    return await processCycleEntryInternal(params, innerTx);
  });
}

export async function forceCreateNextCycleRoot(
  promoterProfileId: string,
  tx?: PrismaTx
) {
  const database = db(tx);
  const summary = await getPromoterCycleSummary(promoterProfileId, tx);

  return await database.cycleNode.create({
    data: {
      promoterProfileId,
      level: summary.activeLevel,
      cycle: summary.activeCycle,
      parentNodeId: null,
      status: "ACTIVE",
      source: "REINVEST",
      sponsoredByPromoterProfileId: null,
    },
  });
}

export async function getCycleTreeSnapshot(
  promoterProfileId: string,
  level?: number,
  cycle?: number,
  tx?: PrismaTx
) {
  const summary = await getPromoterCycleSummary(promoterProfileId, tx);
  const database = db(tx);

  const targetLevel = level || summary.activeLevel;
  const targetCycle = cycle || summary.activeCycle;

  const nodes = await database.cycleNode.findMany({
    where: {
      level: targetLevel,
      cycle: targetCycle,
    },
    orderBy: { createdAt: "asc" },
  });

  return {
    promoterProfileId,
    level: targetLevel,
    cycle: targetCycle,
    nodes: nodes.map(normalizeCycleNode),
  };
}