"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ChevronDown, ChevronRight, Minus, Plus, Scan } from "lucide-react";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Renders a MINDMAP artifact's { nodes, edges } as an actual radial tree
// diagram instead of a flat list. Layout logic adapted from the reference
// implementation (chaibook-llm): pick a root (the node with no incoming
// edges), then lay branches out left/right from it, balancing leaf counts
// so the tree doesn't lean lopsided. Collapse state lives locally per view.
// ---------------------------------------------------------------------------

type MindMapNode = { id: string; label: string };
type MindMapEdge = { id: string; source: string; target: string };

const NODE_WIDTH = 190;
const ROOT_WIDTH = 220;
const NODE_HEIGHT = 44;
const ROW_GAP = 64;
const COL_GAP = 250;

type TreeNode = { id: string; label: string; children: TreeNode[] };
type Placement = { x: number; y: number; direction: 1 | -1 };

function buildTree(nodes: MindMapNode[], edges: MindMapEdge[]): TreeNode | null {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  for (const n of nodes) {
    children.set(n.id, []);
    incoming.set(n.id, 0);
  }
  for (const e of edges) {
    if (!children.has(e.source) || !incoming.has(e.target)) continue;
    children.get(e.source)!.push(e.target);
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
  }

  const claimed = new Set<string>();
  function toTreeNode(id: string): TreeNode | null {
    const source = nodeMap.get(id);
    if (!source || claimed.has(id)) return null;
    claimed.add(id);
    const kids = (children.get(id) ?? []).map(toTreeNode).filter((c): c is TreeNode => c !== null);
    return { id: source.id, label: source.label, children: kids };
  }

  const rootId = nodes.find((n) => (incoming.get(n.id) ?? 0) === 0)?.id ?? nodes[0]?.id;
  if (!rootId) return null;
  const root = toTreeNode(rootId);
  if (!root) return null;

  // Any nodes not reachable from the root (disconnected clusters) get
  // attached as extra top-level branches so nothing silently disappears.
  for (const n of nodes) {
    const orphan = toTreeNode(n.id);
    if (orphan) root.children.push(orphan);
  }
  return root;
}

function countLeaves(node: TreeNode, collapsed: Set<string>): number {
  if (collapsed.has(node.id) || node.children.length === 0) return 1;
  return node.children.reduce((sum, c) => sum + countLeaves(c, collapsed), 0);
}

function layoutBranch(
  node: TreeNode,
  depth: number,
  top: number,
  direction: 1 | -1,
  placements: Map<string, Placement>,
  collapsed: Set<string>
): number {
  const height = countLeaves(node, collapsed) * ROW_GAP;
  const centerX = direction * depth * COL_GAP;
  const centerY = top + height / 2;
  placements.set(node.id, { x: centerX - NODE_WIDTH / 2, y: centerY - NODE_HEIGHT / 2, direction });
  if (!collapsed.has(node.id)) {
    let cursor = top;
    for (const child of node.children) {
      cursor += layoutBranch(child, depth + 1, cursor, direction, placements, collapsed);
    }
  }
  return height;
}

function computeLayout(root: TreeNode, collapsed: Set<string>): Map<string, Placement> {
  const placements = new Map<string, Placement>();
  placements.set(root.id, { x: -ROOT_WIDTH / 2, y: -NODE_HEIGHT / 2, direction: 1 });
  if (collapsed.has(root.id) || root.children.length === 0) return placements;

  // Balance children across left/right branches by running leaf count,
  // so one side doesn't end up much taller than the other.
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
  for (const branch of right) rightCursor += layoutBranch(branch, 1, rightCursor, 1, placements, collapsed);

  let leftCursor = (-leftLeaves * ROW_GAP) / 2;
  for (const branch of left) leftCursor += layoutBranch(branch, 1, leftCursor, -1, placements, collapsed);

  return placements;
}

function collectExpandableIds(node: TreeNode, ids: string[] = []): string[] {
  if (node.children.length > 0) {
    ids.push(node.id);
    for (const c of node.children) collectExpandableIds(c, ids);
  }
  return ids;
}

function MindMapFlowNode({ id, data, selected }: NodeProps) {
  const label = typeof data.label === "string" ? data.label : "Untitled";
  const hasChildren = Boolean(data.hasChildren);
  const collapsed = Boolean(data.collapsed);
  const isRoot = Boolean(data.isRoot);
  const direction = data.direction === -1 ? -1 : 1;
  const onToggle = data.onToggle as ((id: string) => void) | undefined;
  const handleClass = "!h-1.5 !w-1.5 !border-border !bg-muted-foreground";

  return (
    <div
      style={{ width: isRoot ? ROOT_WIDTH : NODE_WIDTH }}
      className={`rounded-2xl border px-3 py-2 text-sm shadow-sm transition-colors ${
        selected
          ? "border-primary bg-primary/15 ring-2 ring-primary/40"
          : isRoot
            ? "border-primary/60 bg-card font-medium text-card-foreground"
            : "border-border bg-card text-card-foreground hover:border-primary/40"
      }`}
    >
      {!isRoot && (
        <Handle
          type="target"
          id={direction === 1 ? "tl" : "tr"}
          position={direction === 1 ? Position.Left : Position.Right}
          className={handleClass}
        />
      )}
      <div className={`flex items-start gap-1.5 ${direction === -1 && !isRoot ? "flex-row-reverse" : ""}`}>
        {hasChildren && (
          <button
            type="button"
            className="mt-0.5 shrink-0 rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onToggle?.(id);
            }}
            aria-label={collapsed ? "Expand branch" : "Collapse branch"}
          >
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}
        <p className={`flex-1 leading-snug ${isRoot ? "text-center" : direction === -1 ? "text-right" : "text-left"}`}>
          {label}
        </p>
      </div>
      {(isRoot || hasChildren) && (
        <Handle
          type="source"
          id={direction === 1 ? "sr" : "sl"}
          position={direction === 1 ? Position.Right : Position.Left}
          className={handleClass}
        />
      )}
    </div>
  );
}

const nodeTypes = { mindmap: MindMapFlowNode };

function MindMapCanvas({ nodes, edges }: { nodes: MindMapNode[]; edges: MindMapEdge[] }) {
  const tree = useMemo(() => buildTree(nodes, edges), [nodes, edges]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { fitView } = useReactFlow();

  const expandableIds = useMemo(() => (tree ? collectExpandableIds(tree) : []), [tree]);
  const placements = useMemo(() => (tree ? computeLayout(tree, collapsed) : new Map()), [tree, collapsed]);
  const parentsWithChildren = useMemo(() => new Set(edges.map((e) => e.source)), [edges]);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

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
            onToggle: toggleCollapse,
          },
        };
      });
  }, [nodes, tree, placements, parentsWithChildren, collapsed, toggleCollapse]);

  const flowEdges: Edge[] = useMemo(
    () =>
      edges
        .filter((e) => placements.has(e.source) && placements.has(e.target) && !collapsed.has(e.source))
        .map((e) => {
          const direction = placements.get(e.target)?.direction ?? 1;
          return {
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: direction === 1 ? "sr" : "sl",
            targetHandle: direction === 1 ? "tl" : "tr",
            type: "bezier",
            style: { stroke: "var(--border)", strokeWidth: 1.5 },
          };
        }),
    [edges, placements, collapsed]
  );

  const expandAll = useCallback(() => setCollapsed(new Set()), []);
  const collapseAll = useCallback(() => setCollapsed(new Set(expandableIds)), [expandableIds]);
  const fitMap = useCallback(() => void fitView({ padding: 0.2, duration: 300 }), [fitView]);

  useEffect(() => {
    const t = window.setTimeout(fitMap, 60);
    return () => window.clearTimeout(t);
  }, [collapsed, fitMap, flowNodes.length]);

  if (!tree) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Mind map data is empty.</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-end gap-1.5 border-b border-border px-3 py-2">
        <Button size="sm" variant="outline" onClick={expandAll}>
          <Plus className="h-3.5 w-3.5" /> Expand all
        </Button>
        <Button size="sm" variant="outline" onClick={collapseAll}>
          <Minus className="h-3.5 w-3.5" /> Collapse all
        </Button>
        <Button size="sm" variant="outline" onClick={fitMap}>
          <Scan className="h-3.5 w-3.5" /> Fit view
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          colorMode="dark"
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.15}
          maxZoom={1.8}
          nodesDraggable={false}
          nodesConnectable={false}
          panOnScroll
          zoomOnScroll
          proOptions={{ hideAttribution: true }}
        >
          <MiniMap
            pannable
            zoomable
            nodeColor="var(--muted-foreground)"
            maskColor="color-mix(in oklab, var(--background) 75%, transparent)"
            className="!rounded-xl !border !border-border !bg-card/90"
          />
          <Controls className="!rounded-xl !border !border-border !bg-card [&>button]:!border-border [&>button]:!bg-card [&>button]:!text-foreground [&>button:hover]:!bg-muted" />
          <Background gap={20} color="var(--border)" />
        </ReactFlow>
      </div>
    </div>
  );
}

export function MindMapViewer({ nodes, edges }: { nodes: MindMapNode[]; edges: MindMapEdge[] }) {
  return (
    <div className="h-full min-h-[480px] w-full overflow-hidden rounded-2xl border border-border bg-muted/20">
      <ReactFlowProvider>
        <MindMapCanvas nodes={nodes} edges={edges} />
      </ReactFlowProvider>
    </div>
  );
}