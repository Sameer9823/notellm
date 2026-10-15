import { Spinner } from "@/components/ui/spinner";

export default function NotebookLoading() {
  return (
    <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Spinner className="h-8 w-8" />
        <p className="text-sm text-muted-foreground">Opening notebook…</p>
      </div>
    </div>
  );
}
