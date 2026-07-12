/**
 * WM优化助手 — 支付回调 (兼容多格式 + 激活兜底)
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://migbxhwvgcddtlhmqtry.supabase.co";
const SUPABASE_KEY = "填你的service_role_key";

function parseDays(name: string): number {
  const m = name.match(/\((\d+)天\)/);
  return m ? parseInt(m[1]) : 30;
}

serve(async (req: Request) => {
  const url = new URL(req.url);
  const params: Record<string, string> = {};

  url.searchParams.forEach((v, k) => { params[k] = v; });
  if (req.method === "POST") {
    try {
      const body = await req.text();
      if (body) {
        if (body.startsWith("{")) { Object.assign(params, JSON.parse(body)); }
        else { body.split("&").forEach(p => { const [k, v] = p.split("="); if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || ""); }); }
      }
    } catch (_) {}
  }

  // 诊断
  if (url.searchParams.get("diag") === "1") {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
      const { data, error } = await supabase.from("users").select("email").limit(1);
      return new Response(JSON.stringify({ ok: !error, dbConnected: !!data }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: String(e) }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }
  }

  // App MAPI 兜底激活
  if (url.searchParams.get("activate") === "1") {
    try {
      const body = await req.json();
      const email = body.email, days = body.days || 30;
      if (!email) return new Response("fail");
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
      const { data: users } = await supabase.from("users").select("vip_expiry").eq("email", email).limit(1);
      if (!users || users.length === 0) return new Response("fail");
      const now = new Date();
      let expiry = users[0].vip_expiry ? new Date(users[0].vip_expiry) : now;
      if (isNaN(expiry.getTime()) || expiry < now) expiry = now;
      expiry.setDate(expiry.getDate() + days);
      await supabase.from("users").update({ vip_expiry: expiry.toISOString() }).eq("email", email);
      return new Response("success");
    } catch (_) { return new Response("fail"); }
  }

  // === 支付回调 ===
  // 兼容多种状态字段名和值
  const tradeStatus = params["trade_status"] || params["status"] || "";
  const isSuccess =
    tradeStatus === "TRADE_SUCCESS" ||
    tradeStatus === "SUCCESS" ||
    tradeStatus === "1" ||
    params["code"] === "1";

  if (!isSuccess) return new Response("fail");

  try {
    // 兼容多种邮箱字段名
    const email = params["param"] || params["attach"] || "";
    if (!email) return new Response("fail");

    const days = parseDays(params["name"] || params["subject"] || "30天");
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data: users } = await supabase.from("users").select("vip_expiry").eq("email", email).limit(1);
    if (!users || users.length === 0) return new Response("fail");

    const now = new Date();
    let expiry = users[0].vip_expiry ? new Date(users[0].vip_expiry) : now;
    if (isNaN(expiry.getTime()) || expiry < now) expiry = now;
    expiry.setDate(expiry.getDate() + days);

    const { error } = await supabase.from("users").update({ vip_expiry: expiry.toISOString() }).eq("email", email);
    return new Response(error ? "fail" : "success");
  } catch (_) {
    return new Response("fail");
  }
});