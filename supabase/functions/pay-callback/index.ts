/**
 * WM优化助手 — 支付回调处理
 * 同时支持 GET 和 POST，兼容不同 ezfpy 版本
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://migbxhwvgcddtlhmqtry.supabase.co";
const SUPABASE_KEY = "填你的service_role_key";

function parseDays(name: string): number {
  const m = name.match(/\((\d+)天\)/);
  return m ? parseInt(m[1]) : 30;
}

// 兼容不同参数名
function getParam(params: Record<string, string>, ...names: string[]): string {
  for (const n of names) if (params[n]) return params[n];
  return "";
}

serve(async (req: Request) => {
  const url = new URL(req.url);
  const params: Record<string, string> = {};
  // 同时从 URL 和 body 获取参数
  url.searchParams.forEach((v, k) => { params[k] = v; });
  if (req.method === "POST") {
    try {
      const body = await req.text();
      if (body) {
        // POST body 可能是 URL-encoded 或 JSON
        if (body.startsWith("{")) {
          Object.assign(params, JSON.parse(body));
        } else {
          body.split("&").forEach(p => { const [k, v] = p.split("="); if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || ""); });
        }
      }
    } catch (_) {}
  }

  // MAPI查单确认后，App主动调用激活（兜底回调失败的情况）
  if (url.searchParams.get("activate") === "1") {
    try {
      const body = await req.json();
      const email = body.email, days = body.days || 30;
      if (!email) return new Response("fail", { status: 200 });
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
      const { data: users } = await supabase.from("users").select("vip_expiry").eq("email", email).limit(1);
      if (!users || users.length === 0) return new Response("fail", { status: 200 });
      const now = new Date();
      let expiry = users[0].vip_expiry ? new Date(users[0].vip_expiry) : now;
      if (isNaN(expiry.getTime()) || expiry < now) expiry = now;
      expiry.setDate(expiry.getDate() + days);
      const { error } = await supabase.from("users").update({ vip_expiry: expiry.toISOString() }).eq("email", email);
      return new Response(error ? "fail" : "success", { status: 200 });
    } catch (_) { return new Response("fail", { status: 200 }); }
  }

  // 诊断
  if (url.searchParams.get("diag") === "1") {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
      const { data, error } = await supabase.from("users").select("email").limit(1);
      return new Response(JSON.stringify({ ok: !error, dbConnected: !!data, method: req.method }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: String(e) }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }
  }

  // 兼容不同状态字段名
  const status = getParam(params, "trade_status", "status", "tradeStatus");
  if (status !== "TRADE_SUCCESS" && status !== "SUCCESS") {
    return new Response("fail", { status: 200 });
  }

  try {
    const email = getParam(params, "param", "attach", "extra");
    const days = parseDays(getParam(params, "name", "subject", "body"));

    if (!email) return new Response("fail", { status: 200 });

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data: users, error } = await supabase.from("users").select("vip_expiry").eq("email", email).limit(1);

    if (error || !users || users.length === 0) return new Response("fail", { status: 200 });

    const now = new Date();
    let expiry = users[0].vip_expiry ? new Date(users[0].vip_expiry) : now;
    if (isNaN(expiry.getTime()) || expiry < now) expiry = now;
    expiry.setDate(expiry.getDate() + days);

    const { error: updateErr } = await supabase.from("users").update({ vip_expiry: expiry.toISOString() }).eq("email", email);
    return new Response(updateErr ? "fail" : "success", { status: 200 });
  } catch (e) {
    return new Response("fail", { status: 200 });
  }
});