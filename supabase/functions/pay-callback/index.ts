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

// 纯JS MD5（Deno Web Crypto 不支持MD5）
function md5(str: string): string {
  function rl(n: number, s: number) { return (n << s) | (n >>> (32 - s)); }
  function au(x: number, y: number) { return (x + y) & 0xFFFFFFFF; }
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i) & 0xFF);
  const bl = bytes.length * 8;
  bytes.push(0x80);
  while ((bytes.length + 8) % 64 !== 0) bytes.push(0);
  for (let i = 0; i < 8; i++) bytes.push((bl >>> (i * 8)) & 0xFF);
  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  for (let i = 0; i < bytes.length; i += 64) {
    const w = new Array(16);
    for (let j = 0; j < 16; j++) w[j] = bytes[i + j * 4] | (bytes[i + j * 4 + 1] << 8) | (bytes[i + j * 4 + 2] << 16) | (bytes[i + j * 4 + 3] << 24);
    let aa = a, bb = b, cc = c, dd = d;
    for (let j = 0; j < 64; j++) {
      let f: number, g: number;
      if (j < 16) { f = (b & c) | (~b & d); g = j; }
      else if (j < 32) { f = (d & b) | (~d & c); g = (5 * j + 1) % 16; }
      else if (j < 48) { f = b ^ c ^ d; g = (3 * j + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * j) % 16; }
      const s = [7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21];
      const sh = j < 16 ? s[j%4] : j < 32 ? s[4+(j%4)] : j < 48 ? s[8+(j%4)] : s[12+(j%4)];
      const tk = (Math.floor(Math.sin(j + 1) * 0x100000000) | 0);
      const temp = au(au(a, f), au(au(w[g], tk), d));
      a = d; d = c; c = b; b = au(b, rl(temp, sh));
    }
    a = au(a, aa); b = au(b, bb); c = au(c, cc); d = au(d, dd);
  }
  const bh = (n: number) => { const h = (n & 0xFF).toString(16); return h.length === 1 ? "0" + h : h; };
  const barr = (n: number) => [bh(n), bh(n >> 8), bh(n >> 16), bh(n >> 24)];
  return barr(a).join("") + barr(b).join("") + barr(c).join("") + barr(d).join("");
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

  // === 支付回调（ezfpy 异步通知 + 官网跳转回调）===
  const tradeStatus = params["trade_status"] || params["status"] || "";
  const isSuccess = tradeStatus === "TRADE_SUCCESS" || tradeStatus === "SUCCESS";
  if (!isSuccess) return new Response("fail");

  // 验证 ezfpy 签名
  const sign = params["sign"] || "";
  if (sign) {
    const signKeys = Object.keys(params).filter(k => k !== "sign" && k !== "sign_type" && params[k] !== "").sort();
    const signStr = signKeys.map(k => k + "=" + params[k]).join("&");
    const expected = md5(signStr + "bhn8q3o0r7Z3OMWyRNs12OpZrx9Zj8vH");
    if (sign !== expected) return new Response("fail");
  }

  try {
    const email = params["param"] || params["attach"] || "";
    if (!email) return new Response("fail");

    const days = parseDays(params["name"] || params["subject"] || "30天");
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    // 防重：检查此订单是否已处理
    const outTradeNo = params["out_trade_no"] || "";
    if (outTradeNo) {
      const { data: dup } = await supabase.from("settings").select("config").eq("email", "order:" + outTradeNo).limit(1);
      if (dup && dup.length > 0) return new Response("success"); // 已处理，返回 success 避免重复通知
    }
    const { data: users } = await supabase.from("users").select("vip_expiry").eq("email", email).limit(1);
    if (!users || users.length === 0) return new Response("fail");

    const now = new Date();
    let expiry = users[0].vip_expiry ? new Date(users[0].vip_expiry) : now;
    if (isNaN(expiry.getTime()) || expiry < now) expiry = now;
    expiry.setDate(expiry.getDate() + days);

    await supabase.from("users").update({ vip_expiry: expiry.toISOString() }).eq("email", email);
    if (outTradeNo) {
      await supabase.from("settings").insert({ email: "order:" + outTradeNo, config: { usedBy: email, days, at: now.toISOString() } });
    }
    return new Response("success");
  } catch (_) {
    return new Response("fail");
  }
});