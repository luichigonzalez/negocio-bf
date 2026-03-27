/* app/lib/cycles/motor.ts */

export const MAX_LEVELS = 10;
export const MAX_CYCLES_PER_LEVEL = 5;
export const MATRIX_WIDTH = 2;

export type CycleNodeStatus = "ACTIVE" | "COMPLETED" | "REINVESTED" | "CLOSED";

export type PositionSource = "DIRECT" | "SPILLOVER" | "REINVEST";

export interface CyclePositionInput {
  promoterProfileId: string;
  parentNodeId: string | null;
  source: PositionSource;
  sponsoredByPromoterProfileId: string | null;
}

export interface CycleNode {
  id: string;
  promoterProfileId: string;
  level: number;
  cycle: number;
  parentNodeId: string | null;
  status: CycleNodeStatus;
  source: PositionSource;
  sponsoredByPromoterProfileId: string | null;
  createdAt: Date;
}

export interface CycleNodeWithChildren extends CycleNode {
  children: CycleNode[];
}

export interface PromoterCycleSummary {
  promoterProfileId: string;
  directCount: number;
  activeLevel: number;
  activeCycle: number;
  isUnlocked: boolean;
}

export interface PlacementTarget {
  nodeId: string;
  promoterProfileId: string;
  level: number;
  cycle: number;
}

export interface PlacementResult {
  placed: boolean;
  reason: string | null;
  targetNodeId: string | null;
  createdNodes: CyclePositionInput[];
  completedNodeIds: string[];
  reinvestedNodeIds: string[];
  closedNodeIds: string[];
  advancedOwnerNodes: CyclePositionInput[];
}

export interface BuildTreeMap {
  [nodeId: string]: CycleNodeWithChildren;
}

function buildNodeMap(nodes: CycleNode[]): BuildTreeMap {
  const map: BuildTreeMap = {};

  const sorted = [...nodes].sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    return ta - tb;
  });

  for (const node of sorted) {
    map[node.id] = {
      ...node,
      children: [],
    };
  }

  for (const node of sorted) {
    if (node.parentNodeId && map[node.parentNodeId]) {
      map[node.parentNodeId].children.push(map[node.id]);
    }
  }

  return map;
}

function countDirects(summary: PromoterCycleSummary): number {
  return Number(summary.directCount || 0);
}

export function isPromoterUnlocked(summary: PromoterCycleSummary): boolean {
  return summary.isUnlocked || countDirects(summary) >= 2;
}

export function getNextLevelCycle(level: number, cycle: number): {
  nextLevel: number;
  nextCycle: number;
  closesBusiness: boolean;
  resetsToLevel1: boolean;
} {
  if (level < 1 || level > MAX_LEVELS) {
    throw new Error("Nivel inválido");
  }

  if (cycle < 1 || cycle > MAX_CYCLES_PER_LEVEL) {
    throw new Error("Ciclo inválido");
  }

  if (cycle < MAX_CYCLES_PER_LEVEL) {
    return {
      nextLevel: level,
      nextCycle: cycle + 1,
      closesBusiness: false,
      resetsToLevel1: false,
    };
  }

  if (level < MAX_LEVELS) {
    return {
      nextLevel: level + 1,
      nextCycle: 1,
      closesBusiness: false,
      resetsToLevel1: false,
    };
  }

  return {
    nextLevel: 1,
    nextCycle: 1,
    closesBusiness: true,
    resetsToLevel1: true,
  };
}

export function getRootNodeForLevelCycle(
  nodes: CycleNode[],
  promoterProfileId: string,
  level: number,
  cycle: number
): CycleNode | null {
  const root = nodes.find(
    (node) =>
      node.promoterProfileId === promoterProfileId &&
      node.level === level &&
      node.cycle === cycle &&
      node.parentNodeId === null &&
      node.status === "ACTIVE"
  );

  return root || null;
}

export function getActiveRootNode(
  nodes: CycleNode[],
  promoterProfileId: string,
  activeLevel: number,
  activeCycle: number
): CycleNode | null {
  return getRootNodeForLevelCycle(nodes, promoterProfileId, activeLevel, activeCycle);
}

export function countOccupiedSpotsInNodeTree(
  allNodes: CycleNode[],
  rootNodeId: string
): number {
  const map = buildNodeMap(allNodes);
  const root = map[rootNodeId];

  if (!root) return 0;

  let count = 0;

  function walk(node: CycleNodeWithChildren) {
    for (const child of node.children) {
      count += 1;
      walk(map[child.id]);
    }
  }

  walk(root);

  return count;
}

export function getRequiredPositionsForCycle(): number {
  return 2;
}

export function isNodeCompleted(
  allNodes: CycleNode[],
  rootNodeId: string
): boolean {
  const occupied = countOccupiedSpotsInNodeTree(allNodes, rootNodeId);
  return occupied >= getRequiredPositionsForCycle();
}

function getNodeChildren(
  allNodes: CycleNode[],
  nodeId: string
): CycleNode[] {
  return allNodes
    .filter((node) => node.parentNodeId === nodeId && node.status === "ACTIVE")
    .sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return ta - tb;
    });
}

function treeContainsPromoter(
  allNodes: CycleNode[],
  rootNodeId: string,
  promoterProfileId: string
): boolean {
  const map = buildNodeMap(allNodes);
  const root = map[rootNodeId];

  if (!root) return false;

  let found = false;

  function walk(node: CycleNodeWithChildren) {
    if (node.promoterProfileId === promoterProfileId && node.id !== rootNodeId) {
      found = true;
      return;
    }

    for (const child of node.children) {
      if (found) return;
      walk(map[child.id]);
    }
  }

  walk(root);
  return found;
}

export function findFirstAvailablePlacement(
  allNodes: CycleNode[],
  rootNodeId: string
): PlacementTarget | null {
  const map = buildNodeMap(allNodes);
  const root = map[rootNodeId];

  if (!root) return null;
  if (root.status !== "ACTIVE") return null;

  const rootChildren = getNodeChildren(allNodes, rootNodeId);

  if (rootChildren.length < getRequiredPositionsForCycle()) {
    return {
      nodeId: root.id,
      promoterProfileId: root.promoterProfileId,
      level: root.level,
      cycle: root.cycle,
    };
  }

  const queue: CycleNodeWithChildren[] = [...rootChildren
    .map((child) => map[child.id])
    .filter(Boolean)];

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current.status !== "ACTIVE") {
      continue;
    }

    if (current.children.length < MATRIX_WIDTH) {
      return {
        nodeId: current.id,
        promoterProfileId: current.promoterProfileId,
        level: current.level,
        cycle: current.cycle,
      };
    }

    for (const child of current.children) {
      const childWithChildren = map[child.id];
      if (childWithChildren?.status === "ACTIVE") {
        queue.push(childWithChildren);
      }
    }
  }

  return null;
}

export function createRootCycleNode(params: {
  promoterProfileId: string;
  level: number;
  cycle: number;
  source?: PositionSource;
  sponsoredByPromoterProfileId?: string | null;
}): CyclePositionInput {
  return {
    promoterProfileId: params.promoterProfileId,
    parentNodeId: null,
    source: params.source || "DIRECT",
    sponsoredByPromoterProfileId: params.sponsoredByPromoterProfileId || null,
  };
}

export function placePromoterInCycle(params: {
  promoterSummary: PromoterCycleSummary;
  uplineSummary: PromoterCycleSummary;
  allNodes: CycleNode[];
  sponsoredByPromoterProfileId?: string | null;
  source?: PositionSource;
}): PlacementResult {
  const {
    promoterSummary,
    uplineSummary,
    allNodes,
    sponsoredByPromoterProfileId = null,
    source = "SPILLOVER",
  } = params;

  const createdNodes: CyclePositionInput[] = [];
  const completedNodeIds: string[] = [];
  const reinvestedNodeIds: string[] = [];
  const closedNodeIds: string[] = [];
  const advancedOwnerNodes: CyclePositionInput[] = [];

  if (!isPromoterUnlocked(uplineSummary)) {
    return {
      placed: false,
      reason: "UPLINE_LOCKED",
      targetNodeId: null,
      createdNodes,
      completedNodeIds,
      reinvestedNodeIds,
      closedNodeIds,
      advancedOwnerNodes,
    };
  }

  const uplineRoot = getActiveRootNode(
    allNodes,
    uplineSummary.promoterProfileId,
    uplineSummary.activeLevel,
    uplineSummary.activeCycle
  );

  if (!uplineRoot) {
    return {
      placed: false,
      reason: "UPLINE_ACTIVE_ROOT_NOT_FOUND",
      targetNodeId: null,
      createdNodes,
      completedNodeIds,
      reinvestedNodeIds,
      closedNodeIds,
      advancedOwnerNodes,
    };
  }

  if (
    treeContainsPromoter(
      allNodes,
      uplineRoot.id,
      promoterSummary.promoterProfileId
    )
  ) {
    return {
      placed: false,
      reason: "PROMOTER_ALREADY_IN_TREE",
      targetNodeId: null,
      createdNodes,
      completedNodeIds,
      reinvestedNodeIds,
      closedNodeIds,
      advancedOwnerNodes,
    };
  }

  const target = findFirstAvailablePlacement(allNodes, uplineRoot.id);

  if (!target) {
    return {
      placed: false,
      reason: "NO_AVAILABLE_POSITION",
      targetNodeId: null,
      createdNodes,
      completedNodeIds,
      reinvestedNodeIds,
      closedNodeIds,
      advancedOwnerNodes,
    };
  }

  createdNodes.push({
    promoterProfileId: promoterSummary.promoterProfileId,
    parentNodeId: target.nodeId,
    source,
    sponsoredByPromoterProfileId,
  });

  const virtualNodes: CycleNode[] = [
    ...allNodes,
    {
      id: `virtual-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      promoterProfileId: promoterSummary.promoterProfileId,
      level: target.level,
      cycle: target.cycle,
      parentNodeId: target.nodeId,
      status: "ACTIVE",
      source,
      sponsoredByPromoterProfileId,
      createdAt: new Date(),
    },
  ];

  if (isNodeCompleted(virtualNodes, uplineRoot.id)) {
    completedNodeIds.push(uplineRoot.id);

    const progression = getNextLevelCycle(uplineRoot.level, uplineRoot.cycle);

    if (uplineRoot.cycle === MAX_CYCLES_PER_LEVEL && uplineRoot.level < MAX_LEVELS) {
      reinvestedNodeIds.push(uplineRoot.id);

      advancedOwnerNodes.push({
        promoterProfileId: uplineRoot.promoterProfileId,
        parentNodeId: null,
        source: "REINVEST",
        sponsoredByPromoterProfileId: uplineRoot.sponsoredByPromoterProfileId,
      });
    }

    if (progression.closesBusiness) {
      closedNodeIds.push(uplineRoot.id);

      advancedOwnerNodes.push({
        promoterProfileId: uplineRoot.promoterProfileId,
        parentNodeId: null,
        source: "REINVEST",
        sponsoredByPromoterProfileId: uplineRoot.sponsoredByPromoterProfileId,
      });
    }

    if (!progression.closesBusiness && uplineRoot.cycle < MAX_CYCLES_PER_LEVEL) {
      advancedOwnerNodes.push({
        promoterProfileId: uplineRoot.promoterProfileId,
        parentNodeId: null,
        source: "REINVEST",
        sponsoredByPromoterProfileId: uplineRoot.sponsoredByPromoterProfileId,
      });
    }
  }

  return {
    placed: true,
    reason: null,
    targetNodeId: target.nodeId,
    createdNodes,
    completedNodeIds,
    reinvestedNodeIds,
    closedNodeIds,
    advancedOwnerNodes,
  };
}

export function getPromoterCycleProgress(params: {
  allNodes: CycleNode[];
  promoterProfileId: string;
  level: number;
  cycle: number;
}) {
  const root = getRootNodeForLevelCycle(
    params.allNodes,
    params.promoterProfileId,
    params.level,
    params.cycle
  );

  if (!root) {
    return {
      hasRoot: false,
      occupied: 0,
      required: getRequiredPositionsForCycle(),
      completed: false,
    };
  }

  const occupied = countOccupiedSpotsInNodeTree(params.allNodes, root.id);

  return {
    hasRoot: true,
    rootNodeId: root.id,
    occupied,
    required: getRequiredPositionsForCycle(),
    completed: occupied >= getRequiredPositionsForCycle(),
  };
}

export function shouldCreateInitialCycleRoot(
  allNodes: CycleNode[],
  promoterProfileId: string,
  activeLevel: number,
  activeCycle: number
): boolean {
  const root = getActiveRootNode(allNodes, promoterProfileId, activeLevel, activeCycle);
  return !root;
}