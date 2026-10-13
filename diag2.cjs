const fs = require("fs");
const path = require("path");
const raw = fs.readFileSync(path.join(__dirname, ".env"), "utf8").replace(/\r/g, "");
const env = {};
for (const line of raw.split("\n")) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
}
process.env.DATABASE_URL = env.DATABASE_URL;
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
(async () => {
  try {
    const srcs = await prisma.source.findMany({
      where: { type: "PDF", storagePath: { not: null } },
      select: { id: true, title: true, storagePath: true },
      take: 5,
    });
    console.log("pdf_sources_with_storage_count:", srcs.length);
    for (const s of srcs) {
      let status = "ERR";
      let detail = "";
      try {
        const res = await fetch(s.storagePath, { method: "GET" });
        status = String(res.status);
        detail = res.headers.get("content-type") || "";
      } catch (e) {
        detail = String(e.code || e.message);
      }
      console.log(JSON.stringify({ id: s.id.slice(0, 8), title: s.title, status, url: s.storagePath.slice(0, 80), detail }));
    }
  } catch (e) {
    console.error("ERR", e);
  } finally {
    await prisma.$disconnect();
  }
})();
