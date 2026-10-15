import { Button } from "@/components/ui/button";
import { FileQuestion, Home } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-6">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-secondary/30 text-muted-foreground">
        <FileQuestion className="h-10 w-10" />
      </div>
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold">Page not found</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          The page you’re looking for doesn’t exist or has been moved. Check the
          URL or head back to your dashboard.
        </p>
      </div>
      <div className="flex gap-3">
        <Button asChild>
          <Link href="/dashboard">
            <Home className="mr-2 h-4 w-4" />
            Go to dashboard
          </Link>
        </Button>
      </div>
    </div>
  );
}
