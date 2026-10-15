"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface ResizablePanelGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  direction?: "horizontal" | "vertical";
  onLayout?: (sizes: number[]) => void;
}

export const ResizablePanelGroup = React.forwardRef<HTMLDivElement, ResizablePanelGroupProps>(
  ({ className, direction = "horizontal", onLayout, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex h-full w-full",
          direction === "vertical" ? "flex-col" : "flex-row",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
ResizablePanelGroup.displayName = "ResizablePanelGroup";

interface ResizablePanelProps extends React.HTMLAttributes<HTMLDivElement> {
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
}

export const ResizablePanel = React.forwardRef<HTMLDivElement, ResizablePanelProps>(
  ({ className, children, defaultSize, minSize, maxSize, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("flex-1 overflow-auto min-w-0 min-h-0", className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);
ResizablePanel.displayName = "ResizablePanel";

interface ResizableHandleProps extends React.HTMLAttributes<HTMLDivElement> {
  direction?: "horizontal" | "vertical";
}

export const ResizableHandle = React.forwardRef<HTMLDivElement, ResizableHandleProps>(
  ({ className, direction = "horizontal", ...props }, ref) => {
    const [dragging, setDragging] = React.useState(false);
    const panelGroupRef = React.useRef<HTMLDivElement>(null);

    const handleMouseDown = (e: React.MouseEvent) => {
      e.preventDefault();
      setDragging(true);
      const panelGroup = e.currentTarget.closest('[data-resizable-group]');
      if (panelGroup) panelGroupRef.current = panelGroup as HTMLDivElement;
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging || !panelGroupRef.current) return;
      // This is a simplified implementation - in a real app you'd calculate sizes
      // and update the panel styles accordingly
    };

    const handleMouseUp = () => {
      setDragging(false);
      panelGroupRef.current = null;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    return (
      <div
        ref={ref}
        className={cn(
          "relative flex items-center justify-center bg-border transition-colors hover:bg-ring/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          direction === "horizontal" ? "w-px h-full cursor-col-resize" : "h-px w-full cursor-row-resize",
          dragging && "bg-ring",
          className
        )}
        onMouseDown={handleMouseDown}
        {...props}
      >
        <div className={cn(
          "bg-border/50 rounded-full",
          direction === "horizontal" ? "w-1 h-8" : "w-8 h-1"
        )} />
      </div>
    );
  }
);
ResizableHandle.displayName = "ResizableHandle";

// Helper to wrap the group with data attribute
export function ResizablePanelGroupWrapper({
  children,
  direction = "horizontal",
  className,
  ...props
}: ResizablePanelGroupProps & { children: React.ReactNode }) {
  return (
    <div data-resizable-group className={cn("flex h-full w-full", direction === "vertical" ? "flex-col" : "flex-row", className)} {...props}>
      {React.Children.map(children, (child, index) => {
        if (!React.isValidElement(child)) return child;
        // Inject handle between panels
        const childrenArray = React.Children.toArray(children);
        if (index < childrenArray.length - 1) {
          return (
            <>
              {child}
              <ResizableHandle direction={direction} />
            </>
          );
        }
        return child;
      })}
    </div>
  );
}