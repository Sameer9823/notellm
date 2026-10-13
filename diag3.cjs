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
console.log("cloud:", cloudName, "key:", apiKey, "secret?", !!apiSecret);

function signParams(params, secret) {
  const sorted = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  return crypto.createHash("sha1").update(sorted + secret).digest("hex");
}

async function upload(publicId) {
  const timestamp = Math.floor(Date.now() / 1000);
  const sig = signParams({ folder: "footnote/test", timestamp, public_id: publicId }, apiSecret);
  const form = new FormData();
  form.append("file", new Blob(["dummy-pdf-content"]));
  form.append("folder", "footnote/test");
  form.append("timestamp", String(timestamp));
  form.append("api_key", apiKey);
  form.append("signature", sig);
  form.append("public_id", publicId);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`, { method: "POST", body: form, signal: AbortSignal.timeout(60000) });
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
  const publicId = "footnotediagtest1234";
  let uploaded;
  try {
    uploaded = await upload(publicId);
    console.log("upload_ok:", uploaded.ok, "upload_status:", uploaded.status);
    console.log("upload_result:", JSON.stringify(uploaded.body));
    const url = uploaded.body?.secure_url || uploaded.body?.url;
    console.log("secure_url:", url);
    if (url) {
      const g = await fetch(url);
      console.log("GET secure_url status:", g.status, "ctype:", g.headers.get("content-type"));
    }
  } catch (e) {
    console.error("ERR", e);
  }
  if (uploaded && uploaded.body && uploaded.body.public_id) {
    try {
      const d = await destroy(uploaded.body.public_id);
      console.log("destroy:", d.status, JSON.stringify(d.body));
    } catch (e) {
      console.error("destroy ERR", e);
    }
  }
})();
