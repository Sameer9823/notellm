import { Spinner } from "@/components/ui/spinner";

export default function SharedNotebookLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Spinner className="h-8 w-8" />
        <p className="text-sm text-muted-foreground">Loading shared notebook…</p>
      </div>
    </div>
  );
}
