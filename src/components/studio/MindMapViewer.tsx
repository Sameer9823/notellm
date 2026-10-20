"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Minus, Plus, Scan, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ---------------------------------------------------------------------------
// Mind map viewer
//  - Builds ONE normalized tree from whatever the LLM returned (cycles, several
//    roots, chains, over-deep nesting) and derives nodes AND edges from that tree,
//    so every visible node is always connected to its parent.
//  - Root + level 1 + level 2 are open by default; deeper branches show "+N".
//  - Branch colors, glowing curved edges, hover path highlight, search, legend.
// ---------------------------------------------------------------------------

type MindMapNode = { id: string; label: string };
type MindMapEdge = { id: string; source: string; target: string };

const MAX_DEPTH = 3; // levels 0..3 are kept; anything deeper is flattened into level 3
const OPEN_DEPTH = 2; // nodes at this depth (and deeper) start collapsed
const ROW_GAP = 66;
const NODE_HEIGHT = 48;
const COL_GAP = 330;

const PALETTE = ["#FBBF24", "#2DD4BF", "#A78BFA", "#FB7185", "#38BDF8", "#A3E635", "#FB923C", "#F472B6"];
const ROOT_GRADIENT = "linear-gradient(135deg,#FBBF24 0%,#FB7185 100%)";
const widthFor = (level: number) => (level === 0 ? 270 : level === 1 ? 270 : level === 2 ? 235 : 215);

type TreeNode = { id: string; label: string; children: TreeNode[] };
type Placement = {
  level: number;
  branch: number;
  parent: string | null;
  color: string;
  x: number;
  y: number;
  direction: 1 | -1;
};

// --------------------------- tree building ---------------------------------

function buildTree(nodes: MindMapNode[], edges: MindMapEdge[]): TreeNode | null {
  if (!nodes.length) return null;
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  const hasParent = new Set<string>();

  for (const e of edges) {
    if (!kids.has(e.source) || !nodeMap.has(e.target) || e.source === e.target) continue;
    if (hasParent.has(e.target)) continue; // keep the first parent only
    hasParent.add(e.target);
    kids.get(e.source)!.push(e.target);
  }

  const claimed = new Set<string>();
  const toTree = (id: string): TreeNode | null => {
    const src = nodeMap.get(id);
    if (!src || claimed.has(id)) return null;
    claimed.add(id);
    const children = (kids.get(id) ?? []).map(toTree).filter((c): c is TreeNode => c !== null);
    return { id: src.id, label: src.label || "Untitled", children };
  };

  const rootId = nodes.find((n) => !hasParent.has(n.id))?.id ?? nodes[0]!.id;
  const root = toTree(rootId);
  if (!root) return null;
  // Anything unreachable from the root (cycles / extra roots) becomes a branch of the root.
  for (const n of nodes) {
    const orphan = toTree(n.id);
    if (orphan) root.children.push(orphan);
  }
  return root;
}

// root -> A -> [B, C, D]  becomes  root -> [B, C, D]
function liftSingleChains(root: TreeNode): TreeNode {
  let r = root;
  while (r.children.length === 1 && r.children[0]!.children.length > 0) {
    r = { ...r, children: r.children[0]!.children };
  }
  return r;
}

const flattenAll = (n: TreeNode): TreeNode[] => [{ ...n, children: [] }, ...n.children.flatMap(flattenAll)];

// Keep at most MAX_DEPTH levels; deeper nodes are re-attached as siblings at the last level
// (instead of being dropped).
function capDepth(n: TreeNode, depth: number): TreeNode {
  if (depth === MAX_DEPTH - 1) return { ...n, children: n.children.flatMap(flattenAll) };
  return { ...n, children: n.children.map((c) => capDepth(c, depth + 1)) };
}

function indexTree(root: TreeNode) {
  const byId = new Map<string, TreeNode>();
  const parentOf = new Map<string, string>();
  const depthOf = new Map<string, number>();
  (function walk(n: TreeNode, d: number, p: string | null) {
    byId.set(n.id, n);
    depthOf.set(n.id, d);
    if (p) parentOf.set(n.id, p);
    n.children.forEach((c) => walk(c, d + 1, n.id));
  })(root, 0, null);
  return { byId, parentOf, depthOf };
}

const countDescendants = (n: TreeNode): number => n.children.reduce((s, c) => s + 1 + countDescendants(c), 0);

// ------------------------------- layout ------------------------------------

function countLeaves(node: TreeNode, collapsed: Set<string>): number {
  if (collapsed.has(node.id) || node.children.length === 0) return 1;
  return node.children.reduce((s, c) => s + countLeaves(c, collapsed), 0);
}

function computeLayout(root: TreeNode, collapsed: Set<string>): Map<string, Placement> {
  const out = new Map<string, Placement>();
  out.set(root.id, {
    level: 0,
    branch: -1,
    parent: null,
    color: PALETTE[0]!,
    x: -widthFor(0) / 2,
    y: -NODE_HEIGHT / 2,
    direction: 1,
  });
  if (collapsed.has(root.id) || root.children.length === 0) return out;

  // Balance branches between the right and the left side using the FULL tree (not the visible
  // part), so a branch never hops sides when something is expanded or collapsed. Biggest
  // branches are assigned first to the lighter side, then each side keeps the original order.
  const full = new Set<string>();
  const weights = root.children.map((child, idx) => ({ child, idx, w: countLeaves(child, full) }));
  const side = new Map<number, 1 | -1>();
  let rw = 0;
  let lw = 0;
  [...weights]
    .sort((a, b) => b.w - a.w || a.idx - b.idx)
    .forEach(({ idx, w }) => {
      if (rw <= lw) {
        side.set(idx, 1);
        rw += w;
      } else {
        side.set(idx, -1);
        lw += w;
      }
    });
  const right: { node: TreeNode; idx: number }[] = [];
  const left: { node: TreeNode; idx: number }[] = [];
  weights.forEach(({ child, idx }) => (side.get(idx) === 1 ? right : left).push({ node: child, idx }));
  const rl = right.reduce((sum, b) => sum + countLeaves(b.node, collapsed), 0);
  const ll = left.reduce((sum, b) => sum + countLeaves(b.node, collapsed), 0);

  const place = (node: TreeNode, depth: number, top: number, dir: 1 | -1, branch: number, parent: string): number => {
    const height = countLeaves(node, collapsed) * ROW_GAP;
    const cx = dir * depth * COL_GAP;
    out.set(node.id, {
      level: depth,
      branch,
      parent,
      color: PALETTE[branch % PALETTE.length]!,
      x: cx - widthFor(depth) / 2,
      y: top + height / 2 - NODE_HEIGHT / 2,
      direction: dir,
    });
    if (!collapsed.has(node.id)) {
      let cursor = top;
      for (const c of node.children) cursor += place(c, depth + 1, cursor, dir, branch, node.id);
    }
    return height;
  };

  let rc = (-rl * ROW_GAP) / 2;
  for (const b of right) rc += place(b.node, 1, rc, 1, b.idx, root.id);
  let lc = (-ll * ROW_GAP) / 2;
  for (const b of left) lc += place(b.node, 1, lc, -1, b.idx, root.id);
  return out;
}

// -------------------------------- node -------------------------------------

function MindMapFlowNode({ id, data }: NodeProps) {
  const label = typeof data.label === "string" ? data.label : "Untitled";
  const level = Number(data.level ?? 0);
  const color = String(data.color ?? "#FBBF24");
  const hasChildren = Boolean(data.hasChildren);
  const collapsed = Boolean(data.collapsed);
  const hiddenCount = Number(data.hiddenCount ?? 0);
  const dim = Boolean(data.dim);
  const match = Boolean(data.match);
  const onToggle = data.onToggle as ((id: string) => void) | undefined;
  const direction = data.direction === -1 ? -1 : 1;
  const isRoot = level === 0;
  const isBranch = level === 1;

  const style: React.CSSProperties = {
    width: widthFor(level),
    minHeight: NODE_HEIGHT - 4,
    opacity: dim ? 0.2 : 1,
    transition: "opacity 160ms, box-shadow 160ms",
    color: isRoot || isBranch ? "#0B0F14" : color,
    background: isRoot ? ROOT_GRADIENT : isBranch ? color : `${color}${level === 2 ? "26" : "18"}`,
    border: `${isRoot ? 2 : 1.5}px solid ${isRoot ? "#FDE68A" : color}`,
    boxShadow: match
      ? `0 0 0 3px #ffffffbb, 0 0 22px ${color}`
      : `0 0 ${isRoot ? 26 : isBranch ? 18 : 10}px ${color}${isRoot || isBranch ? "88" : "55"}`,
    fontSize: isRoot ? 18 : isBranch ? 15 : level === 2 ? 14 : 13,
    fontWeight: isRoot || isBranch ? 700 : 500,
    borderRadius: 999,
    padding: isRoot ? "10px 20px" : "7px 12px",
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexDirection: direction === -1 && !isRoot ? "row-reverse" : "row",
  };
  const hidden = "!h-1 !w-1 !min-h-0 !min-w-0 !border-0 !bg-transparent !opacity-0";

  return (
    <div style={style} title={label}>
      {!isRoot && (
        <Handle
          type="target"
          id={direction === 1 ? "tl" : "tr"}
          position={direction === 1 ? Position.Left : Position.Right}
          className={hidden}
        />
      )}
      <span
        style={{
          flex: 1,
          lineHeight: 1.25,
          textAlign: isRoot ? "center" : direction === -1 ? "right" : "left",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          wordBreak: "break-word",
        }}
      >
        {label}
      </span>
      {hasChildren && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle?.(id);
          }}
          aria-label={collapsed ? "Expand branch" : "Collapse branch"}
          style={{
            flexShrink: 0,
            minWidth: 22,
            height: 22,
            borderRadius: 999,
            padding: "0 6px",
            fontSize: 11,
            fontWeight: 700,
            lineHeight: "22px",
            background: isRoot ? "#0B0F14" : isBranch ? "#0B0F14" : color,
            color: isRoot ? "#FBBF24" : isBranch ? color : "#0B0F14",
            border: "none",
            cursor: "pointer",
          }}
        >
          {collapsed ? `+${hiddenCount}` : "−"}
        </button>
      )}
      {isRoot ? (
        // The root fans out to BOTH sides, so it needs a connection point on each.
        <>
          <Handle type="source" id="sr" position={Position.Right} className={hidden} />
          <Handle type="source" id="sl" position={Position.Left} className={hidden} />
        </>
      ) : (
        hasChildren && (
          <Handle
            type="source"
            id={direction === 1 ? "sr" : "sl"}
            position={direction === 1 ? Position.Right : Position.Left}
            className={hidden}
          />
        )
      )}
    </div>
  );
}

const nodeTypes = { mindmap: MindMapFlowNode };
// Bottom padding keeps the map clear of the minimap / zoom buttons in the bottom-right corner.
const FIT = {
  padding: { top: "28px", right: "28px", bottom: "128px", left: "28px" },
  minZoom: 0.3,
  maxZoom: 1.1,
} as const;

// ------------------------------- canvas ------------------------------------

function MindMapCanvas({ nodes, edges }: { nodes: MindMapNode[]; edges: MindMapEdge[] }) {
  const tree = useMemo(() => {
    const base = buildTree(nodes, edges);
    return base ? capDepth(liftSingleChains(base), 0) : null;
  }, [nodes, edges]);
  const index = useMemo(() => (tree ? indexTree(tree) : null), [tree]);

  const defaultCollapsed = useMemo(() => {
    const s = new Set<string>();
    index?.byId.forEach((n, id) => {
      // NEVER collapse the root: only nodes at OPEN_DEPTH or deeper that have children.
      if ((index.depthOf.get(id) ?? 0) >= OPEN_DEPTH && n.children.length > 0) s.add(id);
    });
    return s;
  }, [index]);

  // User overrides are tied to the tree they were made for, so new data resets to the default.
  const [override, setOverride] = useState<{ forTree: unknown; ids: Set<string> } | null>(null);
  const baseCollapsed = override && override.forTree === tree ? override.ids : defaultCollapsed;

  const [hovered, setHovered] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const { fitView } = useReactFlow();
  const fitViewRef = useRef(fitView);
  useEffect(() => {
    fitViewRef.current = fitView;
  });

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const s = new Set<string>();
    if (!q || !index) return s;
    index.byId.forEach((n, id) => {
      if (n.label.toLowerCase().includes(q)) s.add(id);
    });
    return s;
  }, [query, index]);

  // Every ancestor of a match, so the path to it stays readable while the rest fades.
  const matchPath = useMemo(() => {
    const s = new Set<string>();
    if (!matches.size || !index) return s;
    matches.forEach((id) => {
      let p = index.parentOf.get(id);
      while (p) {
        s.add(p);
        p = index.parentOf.get(p);
      }
    });
    return s;
  }, [matches, index]);

  // Open the path to every search match (without touching the user's own toggles).
  const collapsed = useMemo(() => {
    if (!matches.size || !index) return baseCollapsed;
    const next = new Set(baseCollapsed);
    matches.forEach((id) => {
      let p = index.parentOf.get(id);
      while (p) {
        next.delete(p);
        p = index.parentOf.get(p);
      }
    });
    return next;
  }, [baseCollapsed, matches, index]);

  const placements = useMemo(() => (tree ? computeLayout(tree, collapsed) : new Map<string, Placement>()), [tree, collapsed]);

  const toggle = useCallback(
    (id: string) => {
      setOverride((cur) => {
        const base = cur && cur.forTree === tree ? cur.ids : defaultCollapsed;
        const next = new Set(base);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return { forTree: tree, ids: next };
      });
    },
    [tree, defaultCollapsed]
  );
  const expandAll = useCallback(() => setOverride({ forTree: tree, ids: new Set() }), [tree]);
  const collapseAll = useCallback(() => {
    const s = new Set<string>();
    index?.byId.forEach((n, id) => {
      if ((index.depthOf.get(id) ?? 0) >= 1 && n.children.length > 0) s.add(id);
    });
    setOverride({ forTree: tree, ids: s });
  }, [index, tree]);

  const activePath = useMemo(() => {
    const s = new Set<string>();
    if (!hovered || !index) return s;
    let cur: string | undefined = hovered;
    while (cur) {
      s.add(cur);
      cur = index.parentOf.get(cur);
    }
    return s;
  }, [hovered, index]);

  const flowNodes: Node[] = useMemo(() => {
    if (!index) return [];
    const out: Node[] = [];
    placements.forEach((p, id) => {
      const n = index.byId.get(id)!;
      out.push({
        id,
        type: "mindmap",
        draggable: false,
        position: { x: p.x, y: p.y },
        // Controlled nodes carry no measured size; without these the MiniMap draws nothing.
        initialWidth: widthFor(p.level),
        initialHeight: NODE_HEIGHT,
        data: {
          label: n.label,
          level: p.level,
          color: p.color,
          direction: p.direction,
          hasChildren: n.children.length > 0,
          collapsed: collapsed.has(id),
          hiddenCount: countDescendants(n),
          dim: hovered !== null ? !activePath.has(id) : matches.size > 0 ? !matches.has(id) && !matchPath.has(id) : false,
          match: matches.has(id),
          onToggle: toggle,
        },
      });
    });
    return out;
  }, [index, placements, collapsed, hovered, activePath, matches, matchPath, toggle]);

  // Edges come from the TREE (parent -> child), never from the raw LLM edges.
  const flowEdges: Edge[] = useMemo(() => {
    const out: Edge[] = [];
    placements.forEach((p, id) => {
      if (!p.parent) return;
      const hot = activePath.has(id) && activePath.has(p.parent);
      const dimmed = hovered !== null && !hot;
      const width = (p.level === 1 ? 4.5 : p.level === 2 ? 3 : 2.2) + (hot ? 1.5 : 0);
      out.push({
        id: `${p.parent}->${id}`,
        source: p.parent,
        target: id,
        sourceHandle: p.direction === 1 ? "sr" : "sl",
        targetHandle: p.direction === 1 ? "tl" : "tr",
        type: "default", // smooth bezier
        animated: hot,
        zIndex: hot ? 10 : 1,
        style: {
          stroke: p.color,
          strokeWidth: width,
          opacity: dimmed ? 0.12 : 0.9,
          filter: `drop-shadow(0 0 ${hot ? 7 : 3}px ${p.color})`,
        },
      });
    });
    return out;
  }, [placements, hovered, activePath]);

  const fitMap = useCallback(() => void fitView({ ...FIT, duration: 350 }), [fitView]);

  // Refit whenever the set of visible nodes changes (expand / collapse / search / new data).
  // Keyed on the node ids only; fitView is read through a ref so a changing function identity
  // can never cancel the pending timer.
  const layoutKey = flowNodes.map((n) => n.id).join("|");
  useEffect(() => {
    if (!layoutKey) return;
    const t = window.setTimeout(() => void fitViewRef.current({ ...FIT, duration: 300 }), 120);
    return () => window.clearTimeout(t);
  }, [layoutKey]);

  const focusBranch = useCallback(
    (branch: number) => {
      const ids: { id: string }[] = [];
      placements.forEach((p, id) => {
        if (p.branch === branch) ids.push({ id });
      });
      if (ids.length) void fitView({ nodes: ids, padding: 0.25, minZoom: 0.3, maxZoom: 1.1, duration: 450 });
    },
    [placements, fitView]
  );

  if (!tree || !index) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Mind map data is empty.</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex max-w-full items-center gap-1.5 overflow-x-auto pb-1">
          {tree.children.map((branch, i) => {
            const color = PALETTE[i % PALETTE.length]!;
            return (
              <button
                key={branch.id}
                type="button"
                onClick={() => focusBranch(i)}
                className="flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs hover:bg-muted"
                aria-label={`Zoom to ${branch.label} branch`}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }} />
                <span>{branch.label}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Input
              type="text"
              placeholder="Search mind map..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 w-48 pl-9 text-sm"
              aria-label="Search mind map"
            />
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
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

      <div className="relative min-h-0 flex-1" style={{ background: "radial-gradient(ellipse at center, #111823 0%, #0B0F14 75%)" }}>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          colorMode="dark"
          fitView
          fitViewOptions={FIT}
          minZoom={0.2}
          maxZoom={1.8}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnScroll
          panOnScroll
          panOnScrollSpeed={0.4}
          proOptions={{ hideAttribution: true }}
          onNodeMouseEnter={(_, n) => setHovered(n.id)}
          onNodeMouseLeave={() => setHovered(null)}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.6} color="#ffffff1f" />
          <MiniMap
            pannable
            zoomable
            style={{ width: 150, height: 96, background: "rgba(255,255,255,0.05)", borderRadius: 12 }}
            nodeColor={(n) => String((n.data as { color?: string })?.color ?? "#94a3b8")}
            nodeStrokeWidth={0}
            maskColor="rgba(11,15,20,0.6)"
            className="hidden !rounded-xl !border !border-border sm:block"
          />
          <Controls
            position="bottom-right"
            showFitView={false}
            showInteractive={false}
            style={{ marginBottom: 112 }}
            className="!rounded-xl !border !border-border !bg-card [&>button]:!border-border [&>button]:!bg-card [&>button]:!text-foreground [&>button:hover]:!bg-muted"
          />
          <Panel position="bottom-left" className="pointer-events-none">
            <div className="pointer-events-auto rounded-lg border border-border bg-card/95 px-2 py-1 text-xs text-muted-foreground shadow-sm">
              {query ? `${matches.size} match${matches.size !== 1 ? "es" : ""}` : `${placements.size} of ${index.byId.size} nodes shown`}
            </div>
          </Panel>
        </ReactFlow>
      </div>
    </div>
  );
}

export function MindMapViewer({ nodes, edges }: { nodes: MindMapNode[]; edges: MindMapEdge[] }) {
  return (
    <div className="h-full min-h-[480px] w-full overflow-hidden rounded-2xl border border-border">
      <ReactFlowProvider>
        <MindMapCanvas nodes={nodes} edges={edges} />
      </ReactFlowProvider>
    </div>
  );
}