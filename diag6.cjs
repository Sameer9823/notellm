const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const raw = fs.readFileSync(path.join(__dirname, ".env"), "utf8").replace(/\r/g, "");
const env = {};
for (const line of raw.split("\n")) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
}
const cloudName = env.CLOUDINARY_CLOUD_NAME;
const apiKey = env.CLOUDINARY_API_KEY;
const apiSecret = env.CLOUDINARY_API_SECRET;
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });

function sha1(s) { return crypto.createHash("sha1").update(s).digest("hex"); }
function sha256(s) { return crypto.createHash("sha256").update(s).digest("hex"); }

(async () => {
  try {
    const rows = await prisma.source.findMany({
      where: { type: "PDF", storagePath: { not: null } },
      select: { storagePath: true, storagePublicId: true },
    });
    console.log("all_pdf_paths:", JSON.stringify(rows.map((r) => r.storagePath)));
    const s = rows.find((r) => r.storagePath.includes("sthv3md8")) || rows[0];
    if (!s) { console.log("no pdf rows at all"); return; }
    console.log("sourcePath:", s.storagePath);
    console.log("publicId:", s.storagePublicId);
    const u = s.storagePath;
    const m = u.match(/https:\/\/res\.cloudinary\.com\/([^/]+)\/([^/]+)\/([^/]+)\/upload\/v(\d+)\/(.+)/);
    if (!m) { console.log("no match"); return; }
    const [_, cloud, rt, type, version, publicId] = m;
    console.log("parsed:", { cloud, rt, type, version, publicId });

    const ts = String(Math.floor(Date.now() / 1000));
    const candidates = [
      ["legacy_sha1_pubVer", sha1(publicId + version + apiSecret), ts],
      ["legacy_sha1_pubSlashVerSlash", sha1(publicId + "/" + version + "/" + apiSecret), ts],
      ["sha1_secret_pub_ver", sha1(apiSecret + publicId + version), ts],
      ["sha256_pubVer", sha256(publicId + version + apiSecret), ts],
      ["sha256_path_secret", sha256(`${rt}/${type}/upload/v${version}/${publicId}` + apiSecret), ts],
      ["sha1_path_secret", sha1(`${rt}/${type}/upload/v${version}/${publicId}` + apiSecret), ts],
    ];

    for (const [name, sig, t] of candidates) {
      const url = `${u}?api_key=${apiKey}&timestamp=${t}&signature=${sig}`;
      let st = "ERR";
      try { const g = await fetch(url); st = g.status; } catch (e) { st = "ERR:" + (e.code || e.message); }
      console.log(name, "->", st);
    }
    // also test the raw secure_url with no params (control)
    let st0 = "ERR"; try { const g = await fetch(u); st0 = g.status; } catch (e) {}
    console.log("control (no sig) ->", st0);
  } catch (e) {
    console.error("ERR", e);
  } finally {
    await prisma.$disconnect();
  }
})();
