/**
 * WM优化助手 — 支付回调处理
 * Supabase Edge Function (Deno)
 * 接收 ezfpy 的异步支付通知，自动开通 VIP
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://migbxhwvgcddtlhmqtry.supabase.co";
const SUPABASE_SERVICE_KEY = "sb_publishable_yNJ2_XbCO8ZU2OI-Ee2UTg_ekDPHPom"; // 需要替换为 service_role key

// ezfpy 商户密钥
const EZFPY_KEY = "bhn8q3o0r7Z3OMWyRNs12OpZrx9Zj8vH";

// VIP 套餐匹配（从商品名称提取天数）
function parseDays(name: string): number {
  const m = name.match(/\((\d+)天\)/);
  return m ? parseInt(m[1]) : 30;
}

// MD5 签名验证
async function md5(str: string): Promise<string> {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("MD5", buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// 验证 ezfpy 回调签名
async function verifySign(params: Record<string, string>): Promise<boolean> {
  const sign = params.sign;
  delete params.sign;
  delete params.sign_type;
  const keys = Object.keys(params).sort();
  const str = keys.map(k => k + "=" + params[k]).join("&");
  const expected = await md5(str + EZFPY_KEY);
  return sign === expected;
}

serve(async (req: Request) => {
  const url = new URL(req.url);
  const params: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { params[k] = v; });

  // 验证签名
  const valid = await verifySign({ ...params });
  if (!valid) return new Response("fail", { status: 200 });

  if (params.trade_status === "TRADE_SUCCESS") {
    const email = params.param;
    const days = parseDays(params.name || "");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 查询当前 VIP 到期时间
    const { data: users } = await supabase.from("users").select("vip_expiry").eq("email", email).limit(1);
    if (users && users.length > 0) {
      const now = new Date();
      let expiry = users[0].vip_expiry ? new Date(users[0].vip_expiry) : now;
      if (expiry < now) expiry = now;
      expiry.setDate(expiry.getDate() + days);

      await supabase.from("users").update({ vip_expiry: expiry.toISOString() }).eq("email", email);
    }
  }

  return new Response("success", { status: 200 });
});