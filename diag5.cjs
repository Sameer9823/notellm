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

function signParams(params, secret) {
  const sorted = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  return crypto.createHash("sha1").update(sorted + secret).digest("hex");
}

// Exact replica of lib/cloudinary.ts uploadBuffer
async function uploadBuffer(buffer, opts) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signParamsObj = { folder: opts.folder, timestamp };
  if (opts.publicId) signParamsObj.public_id = opts.publicId;
  const signature = signParams(signParamsObj, apiSecret);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)]), opts.filename ?? "upload");
  form.append("folder", opts.folder);
  form.append("timestamp", String(timestamp));
  form.append("api_key", apiKey);
  form.append("signature", signature);
  if (opts.publicId) form.append("public_id", opts.publicId);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${opts.resourceType}/upload`, { method: "POST", body: form, signal: AbortSignal.timeout(60000) });
  return { ok: res.ok, status: res.status, body: await res.json() };
}

async function destroy(publicId) {
  const timestamp = Math.floor(Date.now() / 1000);
  const sig = signParams({ public_id: publicId, timestamp }, apiSecret);
  const form = new FormData();
  form.append("public_id", publicId);
  form.append("timestamp", String(timestamp));
  form.append("api_key", apiKey);
  form.append("signature", sig);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/raw/destroy`, { method: "POST", body: form, signal: AbortSignal.timeout(20000) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

(async () => {
  const buf = Buffer.from("fake-pdf-bytes-for-diagnostic");
  let up;
  try {
    up = await uploadBuffer(buf, { resourceType: "raw", folder: "footnote/test", filename: "footnotepdftest.pdf" });
    console.log("upload_ok:", up.ok, "status:", up.status);
    console.log("result:", JSON.stringify(up.body));
    const url = up.body?.secure_url;
    if (url) {
      const g = await fetch(url);
      console.log("GET plain status:", g.status, "ctype:", g.headers.get("content-type"), "len:", g.headers.get("content-length"));
    }
  } catch (e) {
    console.error("ERR", e);
  }
  if (up && up.body && up.body.public_id) {
    try { const d = await destroy(up.body.public_id); console.log("destroy:", d.status, JSON.stringify(d.body)); } catch (e) { console.error("destroy ERR", e); }
  }
})();
