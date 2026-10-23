import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { signUpload, cloudinaryEnabled } from "@/lib/cloudinary";
import { z } from "zod";

const querySchema = z.object({
  folder: z.string().min(1).startsWith("footnote/"),
  resourceType: z.enum(["image", "video", "raw"]).optional(),
  publicId: z.string().optional(),
});

export const maxDuration = 10;

/** Returns a Cloudinary upload signature so the browser can POST
 *  directly to Cloudinary without the API secret ever touching the client.
 *  Auth-gated (must be signed in) so anonymous users can't mint signatures. */
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!cloudinaryEnabled()) {
    return NextResponse.json({ error: "Cloudinary is not configured" }, { status: 503 });
  }

  const { searchParams } = req.nextUrl;
  const parsed = querySchema.safeParse({
    folder: searchParams.get("folder"),
    resourceType: searchParams.get("resourceType") ?? undefined,
    publicId: searchParams.get("publicId") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const signature = signUpload({
    folder: parsed.data.folder,
    resourceType: parsed.data.resourceType,
    publicId: parsed.data.publicId,
  });

  return NextResponse.json(signature);
}