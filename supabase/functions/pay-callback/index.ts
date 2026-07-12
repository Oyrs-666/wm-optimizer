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

  // 用户提交开通申请（进入审核队列）
  if (url.searchParams.get("activate") === "1") {
    try {
      const body = await req.json();
      const email = body.email, days = body.days || 30, orderNo = body.orderNo || "";
      if (!email || !orderNo.startsWith("WM")) return new Response("fail");
      const ts = parseInt(orderNo.substring(2)) || 0;
      if (Date.now() - ts > 86400000) return new Response("fail");
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
      // 防重
      const { data: existing } = await supabase.from("settings").select("config").eq("email", "order:" + orderNo).limit(1);
      if (existing && existing.length > 0) return new Response("fail");
      // 检查用户存在
      const { data: users } = await supabase.from("users").select("vip_expiry").eq("email", email).limit(1);
      if (!users || users.length === 0) return new Response("fail");
      // 存入审核队列
      await supabase.from("settings").insert({
        email: "pending:" + orderNo,
        config: { email, days, orderNo, submittedAt: new Date().toISOString(), status: "pending" }
      });
      return new Response("pending");
    } catch (_) { return new Response("fail"); }
  }

  // 管理员批准（需要 admin key）
  if (url.searchParams.get("approve") === "1") {
    try {
      const body = await req.json();
      if (body.key !== "wm-admin-2026") return new Response("unauthorized");
      const orderNo = body.orderNo;
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
      const { data: rows } = await supabase.from("settings").select("config").eq("email", "pending:" + orderNo).limit(1);
      if (!rows || rows.length === 0) return new Response("not_found");
      const cfg = rows[0].config;
      // 激活 VIP
      const { data: users } = await supabase.from("users").select("vip_expiry").eq("email", cfg.email).limit(1);
      if (!users || users.length === 0) return new Response("fail");
      const now = new Date();
      let expiry = users[0].vip_expiry ? new Date(users[0].vip_expiry) : now;
      if (isNaN(expiry.getTime()) || expiry < now) expiry = now;
      expiry.setDate(expiry.getDate() + cfg.days);
      await supabase.from("users").update({ vip_expiry: expiry.toISOString() }).eq("email", cfg.email);
      // 标记为已批准 + 防重
      await supabase.from("settings").insert({ email: "order:" + orderNo, config: { usedBy: cfg.email, approvedAt: now.toISOString() } });
      await supabase.from("settings").delete().eq("email", "pending:" + orderNo);
      return new Response("approved");
    } catch (_) { return new Response("fail"); }
  }

  // 管理员查看待审核列表
  if (url.searchParams.get("pending") === "1") {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
      const { data: rows } = await supabase.from("settings").select("config").like("email", "pending:%");
      const list = (rows || []).map(r => r.config);
      return new Response(JSON.stringify(list), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (_) { return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }); }
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