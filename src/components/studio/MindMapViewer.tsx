"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type FitViewOptions,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ChevronDown, ChevronRight, Minus, Plus, Scan, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type MindMapNode = { id: string; label: string };
type MindMapEdge = { id: string; source: string; target: string };

const NODE_WIDTH = 190;
const ROOT_WIDTH = 240;
const NODE_HEIGHT = 48;
const ROW_GAP = 64;
const COL_GAP = 320;
const MAX_DEPTH = 3;

const BRANCH_COLORS = [
  "#F59E0B",
  "#0D9488",
  "#8B5CF6",
  "#F43F5E",
  "#0EA5E9",
  "#84CC16",
  "#F97316",
  "#EC4899",
] as const;

const TINT_OPACITIES = ["33", "55", "77", "99"];

type TreeNode = { id: string; label: string; children: TreeNode[] };
type Placement = { x: number; y: number; direction: 1 | -1; depth: number; branchIndex: number };

function toInlineTokens(text: string): string[] {
  return text.split(/[,|]/).map((s) => s.trim()).filter(Boolean);
}

function flattenOrphanSingleChild(root: TreeNode): TreeNode {
  while (root.children.length === 1 && root.children[0]?.children.length > 0) {
    const only = root.children[0];
    root.children = only.children;
  }
  return root;
}

function buildTree(nodes: MindMapNode[], edges: MindMapEdge[]): TreeNode | null {
  if (!nodes.length) return null;

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  const seenParents = new Map<string, Set<string>>();

  for (const n of nodes) {
    children.set(n.id, []);
    incoming.set(n.id, 0);
    seenParents.set(n.id, new Set());
  }

  for (const e of edges) {
    if (!children.has(e.source) || !incoming.has(e.target)) continue;
    if (e.source === e.target) continue;
    const parentSet = seenParents.get(e.target)!;
    if (parentSet.has(e.source)) continue;
    parentSet.add(e.source);
    children.get(e.source)!.push(e.target);
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
  }

  const claimed = new Set<string>();

  function toTreeNode(id: string, depth: number): TreeNode | null {
    const source = nodeMap.get(id);
    if (!source || claimed.has(id)) return null;
    claimed.add(id);
    const kids = (children.get(id) ?? [])
      .map((c) => toTreeNode(c, depth + 1))
      .filter((c): c is TreeNode => c !== null);
    return { id: source.id, label: source.label, children: depth >= MAX_DEPTH ? [] : kids };
  }

  const rootCandidates = nodes.filter((n) => (incoming.get(n.id) ?? 0) === 0);
  const rootId = rootCandidates.length > 0 ? rootCandidates[0]!.id : nodes[0]?.id;
  if (!rootId) return null;

  const root = toTreeNode(rootId, 0);
  if (!root) return null;

  flattenOrphanSingleChild(root);

  for (const n of nodes) {
    const orphan = toTreeNode(n.id, 0);
    if (orphan && orphan !== root) root.children.push(orphan);
  }

  return root;
}

function assignBranchColors(root: TreeNode): Map<string, string> {
  const colorMap = new Map<string, string>();
  colorMap.set(root.id, "#F59E0B");
  root.children.forEach((c, i) => {
    const color = BRANCH_COLORS[i % BRANCH_COLORS.length];
    colorMap.set(c.id, color);
    const stack: TreeNode[] = [c];
    while (stack.length) {
      const node = stack.pop()!;
      for (const child of node.children) {
        colorMap.set(child.id, color);
        stack.push(child);
      }
    }
  });
  return colorMap;
}

function countLeaves(node: TreeNode, collapsed: Set<string>): number {
  if (collapsed.has(node.id) || node.children.length === 0) return 1;
  return node.children.reduce((sum, c) => sum + countLeaves(c, collapsed), 0);
}

function measureLabel(label: string): number {
  const tokens = toInlineTokens(label);
  if (tokens.length === 1) return Math.min(label.length * 8 + 48, NODE_WIDTH);
  return NODE_WIDTH;
}

function layoutBranch(
  node: TreeNode,
  depth: number,
  top: number,
  direction: 1 | -1,
  branchIndex: number,
  placements: Map<string, Placement>,
  collapsed: Set<string>
): number {
  const height = countLeaves(node, collapsed) * ROW_GAP;
  const centerX = direction * depth * COL_GAP + direction * 10;
  const centerY = top + height / 2;
  placements.set(node.id, {
    x: centerX - measureLabel(node.label) / 2,
    y: centerY - NODE_HEIGHT / 2,
    direction,
    depth,
    branchIndex,
  });

  if (!collapsed.has(node.id) && depth < MAX_DEPTH) {
    let cursor = top;
    for (const child of node.children) {
      cursor += layoutBranch(child, depth + 1, cursor, direction, branchIndex, placements, collapsed);
    }
  }
  return height;
}

function computeLayout(root: TreeNode, collapsed: Set<string>): Map<string, Placement> {
  const placements = new Map<string, Placement>();
  placements.set(root.id, {
    x: -measureLabel(root.label) / 2,
    y: -NODE_HEIGHT / 2,
    direction: 1,
    depth: 0,
    branchIndex: 0,
  });

  if (collapsed.has(root.id) || root.children.length === 0) return placements;

  const right: TreeNode[] = [];
  const left: TreeNode[] = [];
  let rightLeaves = 0;
  let leftLeaves = 0;

  for (const child of root.children) {
    const leaves = countLeaves(child, collapsed);
    if (rightLeaves <= leftLeaves) {
      right.push(child);
      rightLeaves += leaves;
    } else {
      left.push(child);
      leftLeaves += leaves;
    }
  }

  let rightCursor = (-rightLeaves * ROW_GAP) / 2;
  right.forEach((branch, i) => {
    rightCursor += layoutBranch(branch, 1, rightCursor, 1, i, placements, collapsed);
  });

  let leftCursor = (-leftLeaves * ROW_GAP) / 2;
  left.forEach((branch, i) => {
    leftCursor += layoutBranch(branch, 1, leftCursor, -1, i, placements, collapsed);
  });

  return placements;
}

function collectExpandableIds(node: TreeNode, ids: string[] = []): string[] {
  if (node.children.length > 0) {
    ids.push(node.id);
    for (const c of node.children) collectExpandableIds(c, ids);
  }
  return ids;
}

function collectCollapsibleAtDepth(node: TreeNode, ids: string[], maxDepth: number): string[] {
  if (node.children.length > 0) {
    ids.push(node.id);
    if (maxDepth > 0) {
      for (const c of node.children) collectCollapsibleAtDepth(c, ids, maxDepth - 1);
    }
  }
  return ids;
}

function getColorForDepth(color: string, depth: number): string {
  if (depth <= 1) return color;
  const opacity = TINT_OPACITIES[Math.min(depth - 2, TINT_OPACITIES.length - 1)];
  return `${color}${opacity}`;
}

function getTextColorForBackground(bgColor: string): string {
  const hex = bgColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16) || 0;
  const g = parseInt(hex.substring(2, 2), 16) || 0;
  const b = parseInt(hex.substring(4, 2), 16) || 0;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? "#1A1C1F" : "#FFFFFF";
}

function MindMapFlowNode({ data, selected, id }: NodeProps) {
  const label = typeof data.label === "string" ? data.label : "Untitled";
  const hasChildren = Boolean(data.hasChildren);
  const collapsed = Boolean(data.collapsed);
  const isRoot = Boolean(data.isRoot);
  const depth = data.depth as number;
  const branchColor = data.branchColor as string;
  const onToggle = data.onToggle as ((id: string) => void) | undefined;
  const searchMatch = Boolean(data.searchMatch);
  const searchPath = Boolean(data.searchPath);

  const depthFontSizes = {
    0: "text-xl font-black",
    1: "text-lg font-bold",
    2: "text-base font-medium",
    3: "text-sm font-medium",
  } as const;

  const fontClass = depthFontSizes[depth as keyof typeof depthFontSizes] ?? "text-sm font-medium";
  const baseColor = isRoot ? "#F59E0B" : branchColor;
  const bgColor = getColorForDepth(baseColor, depth);
  const textColor = isRoot ? "#78350F" : getTextColorForBackground(baseColor);
  const nodeWidth = isRoot ? ROOT_WIDTH : NODE_WIDTH;

  const tokens = toInlineTokens(label);
  const displayLines = tokens.slice(0, 2);
  const fullText = tokens.length > 2 ? tokens.join(" · ") : label;

  const direction = data.direction === -1 ? -1 : 1;

  let highlightClass = "";
  let ringClass = "ring-1 ring-border/30";
  if (searchMatch) {
    highlightClass = "ring-2 ring-yellow-400/70";
    ringClass = "";
  } else if (searchPath) {
    highlightClass = "ring-1 ring-yellow-400/50";
  }
  if (selected) ringClass = "ring-2 ring-primary/50";

  return (
    <div
      style={{ width: nodeWidth, backgroundColor: bgColor, color: textColor }}
      className={`relative box-border cursor-default rounded-2xl border-2 px-3 py-2 text-center shadow-md transition-all duration-200 ${highlightClass} ${ringClass} ${fontClass}`}
      role="button"
      tabIndex={0}
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle?.(id);
        }
      }}
    >
      {!isRoot && (
        <Handle
          type="target"
          id={direction === 1 ? "tl" : "tr"}
          position={direction === 1 ? Position.Left : Position.Right}
          className="h-1 w-1 border-0 bg-transparent !opacity-0"
        />
      )}
      <div className={`flex items-center justify-center gap-1 ${direction === -1 && !isRoot ? "flex-row-reverse" : ""}`}>
        {hasChildren && depth < MAX_DEPTH && (
          <button
            type="button"
            className="shrink-0 rounded-md p-0.5 text-muted-foreground/70 hover:bg-black/10 hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            onClick={(e) => {
              e.stopPropagation();
              onToggle?.(id);
            }}
            aria-label={collapsed ? "Expand branch" : "Collapse branch"}
          >
            {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        )}
        <p
          className="flex-1 cursor-default truncate px-1 text-center align-middle leading-tight"
          title={fullText}
        >
          {displayLines.length > 0 ? displayLines.join(" · ") : label}
        </p>
      </div>
      {(isRoot || hasChildren) && depth < MAX_DEPTH && (
        <Handle
          type="source"
          id={direction === 1 ? "sr" : "sl"}
          position={direction === 1 ? Position.Right : Position.Left}
          className="h-1 w-1 border-0 bg-transparent !opacity-0"
        />
      )}
      {tokens.length > 2 && (
        <span className="absolute bottom-1 right-1 rounded-full bg-black/20 px-1 text-[9px] font-bold leading-none opacity-80">
          +{tokens.length - 2}
        </span>
      )}
    </div>
  );
}

MindMapFlowNode.displayName = "MindMapFlowNode";

const nodeTypes = { mindmap: MindMapFlowNode };

const nodeColorsForMiniMap = (node: Node) => {
  const nodeData = node.data as { branchColor?: string; isRoot?: boolean };
  if (nodeData.isRoot) return "#F59E0B";
  return nodeData.branchColor ?? "#6B7280";
};

function MindMapCanvas({ nodes, edges }: { nodes: MindMapNode[]; edges: MindMapEdge[] }) {
  const tree = useMemo(() => buildTree(nodes, edges), [nodes, edges]);
  const [baseCollapsed, setBaseCollapsed] = useState<Set<string>>(
    () => new Set(tree ? collectCollapsibleAtDepth(tree, [], 2) : [])
  );
  const { fitView, setCenter, getNodes } = useReactFlow();
  const [searchTerm, setSearchTerm] = useState("");
  const hasMoreThan40Nodes = nodes.length > 40;

  const colorMap = useMemo(() => (tree ? assignBranchColors(tree) : new Map()), [tree]);
  const expandableIds = useMemo(() => (tree ? collectExpandableIds(tree) : []), [tree]);
  const parentsWithChildren = useMemo(() => new Set(edges.map((e) => e.source)), [edges]);

  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const toggleCollapse = useCallback((id: string) => {
    setBaseCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => setBaseCollapsed(new Set()), []);
  const collapseAll = useCallback(() => setBaseCollapsed(new Set(expandableIds)), [expandableIds]);
  const fitMap = useCallback(() => {
    void fitView({ padding: 0.2, duration: 300, minZoom: 0.5, maxZoom: 1.2 });
  }, [fitView]);

  const pathToRoot = useCallback(
    (nodeId: string): string[] => {
      const path: string[] = [nodeId];
      let current = nodeId;
      for (const e of edges) {
        if (e.target === current) {
          path.push(e.source);
          current = e.source;
        }
      }
      return path;
    },
    [edges]
  );

  const highlightedNodes = useMemo(() => {
    if (!hoveredNode) return new Set<string>();
    return new Set(pathToRoot(hoveredNode));
  }, [hoveredNode, pathToRoot]);

  const { searchMatchIds, searchPathIds } = useMemo(() => {
    if (!tree || !searchTerm.trim()) return { searchMatchIds: new Set<string>(), searchPathIds: new Set<string>() };
    const term = searchTerm.toLowerCase();
    const matched: string[] = [];
    const find = (n: TreeNode) => {
      if (n.label.toLowerCase().includes(term)) matched.push(n.id);
      for (const c of n.children) find(c);
    };
    find(tree);

    const nodeSet = new Set(matched);
    const pathSet = new Set(matched);
    for (const id of matched) {
      const p = pathToRoot(id);
      for (const part of p) pathSet.add(part);
    }
    return { searchMatchIds: nodeSet, searchPathIds: pathSet };
  }, [tree, searchTerm, pathToRoot]);

  const searchExpandedIds = useMemo(() => {
    if (!tree || searchMatchIds.size === 0) return new Set<string>();
    const expanded = new Set<string>();
    for (const id of searchMatchIds) {
      for (const ancestor of pathToRoot(id)) expanded.add(ancestor);
    }
    return expanded;
  }, [tree, searchMatchIds, pathToRoot]);

  const collapsed = useMemo(() => {
    if (!tree) return new Set<string>();
    const effective = new Set(baseCollapsed);
    for (const id of searchExpandedIds) effective.delete(id);
    return effective;
  }, [tree, baseCollapsed, searchExpandedIds]);

  const placements = useMemo(() => (tree ? computeLayout(tree, collapsed) : new Map()), [tree, collapsed]);

  const flowNodes: Node[] = useMemo(() => {
    if (!tree) return [];
    return nodes
      .filter((n) => placements.has(n.id))
      .map((n) => {
        const p = placements.get(n.id)!;
        return {
          id: n.id,
          type: "mindmap",
          draggable: false,
          position: { x: p.x, y: p.y },
          data: {
            label: n.label,
            hasChildren: parentsWithChildren.has(n.id),
            collapsed: collapsed.has(n.id),
            isRoot: n.id === tree.id,
            direction: p.direction,
            depth: p.depth,
            branchColor: colorMap.get(n.id) ?? "#6B7280",
            onToggle: toggleCollapse,
            searchMatch: searchMatchIds.has(n.id),
            searchPath: searchPathIds.has(n.id),
          },
        };
      });
  }, [nodes, tree, placements, parentsWithChildren, collapsed, toggleCollapse, colorMap, searchMatchIds, searchPathIds]);

  const flowEdges: Edge[] = useMemo(() => {
    const glowIntensity = hasMoreThan40Nodes ? 0 : 4;
    return edges
      .filter((e) => placements.has(e.source) && placements.has(e.target) && !collapsed.has(e.source))
      .map((e) => {
        const targetPlacement = placements.get(e.target);
        const direction = targetPlacement ? targetPlacement.direction : 1;
        const sourceBranch = colorMap.get(e.source) ?? "#6B7280";
        const isDimmed = hoveredNode !== null && !highlightedNodes.has(e.source);
        const inSearchPath = searchPathIds.has(e.source);
        const strokeWidth = targetPlacement ? Math.max(1.5, 5 - targetPlacement.depth * 0.8) : 1.5;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: direction === 1 ? "sr" : "sl",
          targetHandle: direction === 1 ? "tl" : "tr",
          type: "bezier",
          animated: hoveredNode !== null && highlightedNodes.has(e.source),
          style: {
            stroke: inSearchPath ? "#eab308" : sourceBranch,
            strokeWidth: isDimmed ? strokeWidth * 0.4 : inSearchPath ? strokeWidth * 1.3 : strokeWidth,
            filter:
              hoveredNode !== null && highlightedNodes.has(e.source)
                ? `drop-shadow(0 0 ${glowIntensity}px ${sourceBranch})`
                : `drop-shadow(0 0 ${glowIntensity}px ${sourceBranch})`,
            opacity: isDimmed ? 0.3 : 1,
          },
        };
      });
  }, [edges, placements, collapsed, colorMap, hoveredNode, highlightedNodes, hasMoreThan40Nodes, searchPathIds]);

  const handleNodeMouseEnter = useCallback((_event: React.MouseEvent, node: Node) => {
    const nodeData = node.data as { isRoot?: boolean };
    if (!nodeData.isRoot) {
      setHoveredNode(node.id);
    }
  }, []);

  const handleNodeMouseLeave = useCallback(() => {
    setHoveredNode(null);
  }, []);

  const handleSearch = useCallback(() => {
    if (!tree || searchMatchIds.size === 0) return;
    const firstMatch = Array.from(searchMatchIds)[0]!;
    const targetNode = flowNodes.find((n) => n.id === firstMatch);
    if (targetNode) {
      setCenter(targetNode.position.x + NODE_WIDTH / 2, targetNode.position.y + NODE_HEIGHT / 2, {
        zoom: 1,
        duration: 500,
      });
    }
  }, [tree, searchMatchIds, flowNodes, setCenter]);

  useEffect(() => {
    if (searchTerm && searchMatchIds.size > 0) {
      void handleSearch();
    }
  }, [searchTerm, searchMatchIds, handleSearch]);

  const handleLegendClick = useCallback(
    (color: string) => {
      const branchNode = flowNodes.find((n) => {
        const d = n.data as { branchColor?: string; isRoot?: boolean };
        return d.branchColor === color && d.isRoot !== true;
      });
      if (branchNode) {
        setCenter(branchNode.position.x + NODE_WIDTH / 2, branchNode.position.y + NODE_HEIGHT / 2, {
          zoom: 0.6,
          duration: 500,
        });
      }
    },
    [flowNodes, setCenter]
  );

  useEffect(() => {
    const t = window.setTimeout(() => {
      void fitView({ padding: 0.15, duration: 500, minZoom: 0.6, maxZoom: 1.5 });
    }, 60);
    return () => window.clearTimeout(t);
  }, [fitView]);

  const nodeIds = useMemo(() => getNodes().map((n) => n.id), [getNodes]);

  if (!tree) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Mind map data is empty.</div>;
  }

  const fitViewOptions: FitViewOptions = { padding: 0.2, minZoom: 0.6, maxZoom: 1.5 };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {tree.children.map((branch, i) => {
            const color = BRANCH_COLORS[i % BRANCH_COLORS.length];
            return (
              <button
                key={branch.id}
                type="button"
                onClick={() => handleLegendClick(color)}
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs whitespace-nowrap hover:bg-muted"
                aria-label={`Zoom to ${branch.label} branch`}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                <span>{branch.label}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Input
              type="search"
              placeholder="Search mind map..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-8 w-48 pl-9 text-sm"
              aria-label="Search mind map"
            />
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 hover:text-muted-foreground"
                aria-label="Clear search"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={expandAll} aria-label="Expand all branches">
            <Plus className="h-3.5 w-3.5" /> Expand all
          </Button>
          <Button size="sm" variant="outline" onClick={collapseAll} aria-label="Collapse all branches">
            <Minus className="h-3.5 w-3.5" /> Collapse all
          </Button>
          <Button size="sm" variant="outline" onClick={fitMap} aria-label="Fit view to mind map">
            <Scan className="h-3.5 w-3.5" /> Fit view
          </Button>
        </div>
      </div>

      {searchTerm && searchMatchIds.size === 0 && (
          <div className="px-3 py-2 text-xs text-muted-foreground">No matches for &quot;{searchTerm}&quot;</div>
      )}

      <div className="relative min-h-0 flex-1">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          fitView={false}
          fitViewOptions={fitViewOptions}
          minZoom={0.4}
          maxZoom={2}
          nodesDraggable={false}
          nodesConnectable={false}
          zoomOnScroll
          panOnScroll
          panOnScrollSpeed={0.4}
          selectionOnDrag={false}
          proOptions={{ hideAttribution: true }}
          onNodeMouseEnter={handleNodeMouseEnter}
          onNodeMouseLeave={handleNodeMouseLeave}
        >
          <Background gap={20} size={1} color="var(--border)" bgColor="var(--background)" />
          <MiniMap
            pannable
            zoomable
            nodeColor={nodeColorsForMiniMap}
            nodeStrokeWidth={2}
            nodeBorderRadius={6}
            maskColor="color-mix(in oklab, var(--background) 55%, transparent)"
            bgColor="color-mix(in oklab, var(--background) 70%, transparent)"
            className="hidden rounded-xl border border-border bg-card/90 sm:block"
          />
          <Controls
            position="bottom-right"
            className="!rounded-xl !border !border-border !bg-card [&>button]:!border-border [&>button]:!bg-card [&>button]:!text-foreground [&>button:hover]:!bg-muted"
            showZoom
            showFitView={false}
            showInteractive={false}
          />
          <Panel position="top-center" className="pointer-events-none">
            <div className="pointer-events-auto rounded-lg border border-border bg-card/95 px-2 py-1 text-xs text-muted-foreground shadow-sm">
              {searchTerm ? `${searchMatchIds.size} match${searchMatchIds.size !== 1 ? "es" : ""}` : `${nodeIds.length} nodes`}
            </div>
          </Panel>
        </ReactFlow>
      </div>
    </div>
  );
}

MindMapCanvas.displayName = "MindMapCanvas";

export function MindMapViewer({ nodes, edges }: { nodes: MindMapNode[]; edges: MindMapEdge[] }) {
  return (
    <div className="h-full min-h-[480px] w-full animate-in fade-in-0 overflow-hidden rounded-2xl border border-border bg-muted/20">
      <ReactFlowProvider>
        <MindMapCanvas nodes={nodes} edges={edges} />
      </ReactFlowProvider>
    </div>
  );
}
