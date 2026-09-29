export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST required" });

  const base = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
  if (!base || !key) return res.status(500).json({ ok: false, error: "Supabase environment is not configured." });

  try {
    const response = await fetch(`${base}/functions/v1/irev-process`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(req.body ?? {}),
    });

    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = { ok: false, error: text || `HTTP ${response.status}` }; }
    return res.status(response.status).json(body);
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
