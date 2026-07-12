/**
 * WM优化助手 — 云端 API（零依赖）
 * Vercel Serverless + Supabase REST API
 */
const SUPABASE_URL = 'https://migbxhwvgcddtlhmqtry.supabase.co';
const SUPABASE_KEY = 'sb_publishable_yNJ2_XbCO8ZU2OI-Ee2UTg_ekDPHPom';
const SUPABASE_REST = SUPABASE_URL + '/rest/v1';

// ========== 支付配置（ezfpy 易支付）==========
const PAY_CONFIG = {
  pid: '5758',
  key: 'bhn8q3o0r7Z3OMWyRNs12OpZrx9Zj8vH',
  api: 'https://www.ezfpy.cn/submit.php',
  api_mapi: 'https://www.ezfpy.cn/mapi.php',
  notify_url: 'https://wm-optimizer-git-master-dy-wmm.vercel.app/api/pay/callback',
  return_url: 'https://oyrs-666.github.io/wm-optimizer'
};

function sbReq(path, method, body) {
  return new Promise((resolve) => {
    var u = require('url').parse(SUPABASE_REST + path);
    var h = {
      hostname: u.hostname, port: 443, path: u.path, method: method,
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json', 'Prefer': 'return=representation' }
    };
    if (body) h.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));
    var req = require('https').request(h, function(res) {
      var d = ''; res.on('data', function(c) { d += c }); res.on('end', function() {
        try { resolve({ ok: res.statusCode < 300, data: JSON.parse(d), status: res.statusCode }) }
        catch(e) { resolve({ ok: false, data: null, status: res.statusCode }) }
      });
    });
    req.on('error', function(e) { resolve({ ok: false, error: e.message }) });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function md5(str) {
  return require('crypto').createHash('md5').update(str, 'utf8').digest('hex');
}

// 生成易支付签名
function makePaySign(params, key) {
  var keys = Object.keys(params).sort();
  var str = keys.map(function(k) { return k + '=' + params[k]; }).join('&');
  return md5(str + key);
}

// HTTP GET 请求
function httpGet(url) {
  return new Promise((resolve) => {
    var u = require('url').parse(url);
    require('https').get({ hostname: u.hostname, path: u.pathname + (u.search||''), port: 443, timeout: 10000 }, function(res) {
      var d = ''; res.on('data', function(c) { d += c }); res.on('end', function() { resolve(d) });
    }).on('error', function() { resolve('') });
  });
}

// VIP 套餐定义
var VIP_PLANS = { day: 1, week: 7, month: 30, quarter: 90, year: 365 };
var VIP_PRICES = { day: '3.00', week: '12.00', month: '28.00', quarter: '45.00', year: '88.00' };

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var u = new URL(req.url, 'http://localhost');
  var p = u.pathname, m = req.method;
  var body = null;
  if (m === 'POST') {
    try {
      var chunks = [];
      req.on('data', function(c) { chunks.push(c) });
      await new Promise(function(r) { req.on('end', r) });
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch(e) { body = {}; }
  }

  try {
    // === 注册 ===
    if (p === '/api/register' && m === 'POST') {
      var email = (body.email||'').trim(), pw = body.password||'';
      if (!email || !pw) return res.status(400).json({ error: '邮箱密码不能为空' });
      if (pw.length < 6) return res.status(400).json({ error: '密码至少6位' });
      var cr = await sbReq('/users?email=eq.' + encodeURIComponent(email) + '&select=email', 'GET');
      if (cr.ok && cr.data && cr.data.length > 0) return res.status(400).json({ error: '该邮箱已注册' });
      var ir = await sbReq('/users', 'POST', { email: email, password: pw, created_at: new Date().toISOString() });
      return res.status(ir.ok ? 200 : 500).json(ir.ok ? { success: true } : { error: '注册失败' });
    }

    // === 登录 ===
    if (p === '/api/login' && m === 'POST') {
      var email = (body.email||'').trim(), pw = body.password||'';
      var lr = await sbReq('/users?email=eq.' + encodeURIComponent(email) + '&select=*', 'GET');
      if (!lr.ok || !lr.data || lr.data.length === 0) return res.status(400).json({ error: '账号不存在' });
      if (lr.data[0].password !== pw) return res.status(400).json({ error: '密码错误' });
      return res.status(200).json({ success: true, email: lr.data[0].email });
    }

    // === 获取设置 ===
    if (p === '/api/settings' && m === 'GET') {
      var email = u.searchParams.get('email');
      if (!email) return res.status(400).json({ error: '缺少email' });
      var sr = await sbReq('/settings?email=eq.' + encodeURIComponent(email) + '&select=config', 'GET');
      return res.status(200).json(sr.data && sr.data.length > 0 ? (sr.data[0].config || {}) : { autoStart: false });
    }

    // === 保存设置 ===
    if (p === '/api/settings' && m === 'POST') {
      var email = body.email, config = body.config;
      if (!email) return res.status(400).json({ error: '缺少email' });
      var ur = await sbReq('/settings?email=eq.' + encodeURIComponent(email), 'GET');
      if (ur.ok && ur.data && ur.data.length > 0) {
        var pr = await sbReq('/settings?email=eq.' + encodeURIComponent(email), 'PATCH', { config: config, updated_at: new Date().toISOString() });
        return res.status(pr.ok ? 200 : 500).json(pr.ok ? { success: true } : { error: '保存失败' });
      }
      var ir = await sbReq('/settings', 'POST', { email: email, config: config, updated_at: new Date().toISOString() });
      return res.status(ir.ok ? 200 : 500).json(ir.ok ? { success: true } : { error: '保存失败' });
    }

    // ===================== 支付 API =====================

    // === 创建支付订单 ===
    if (p === '/api/pay/create' && m === 'POST') {
      var email = (body.email||'').trim(), plan = body.plan || 'month';
      if (!email) return res.status(400).json({ error: '请提供邮箱账号' });
      if (!VIP_PLANS[plan]) return res.status(400).json({ error: '无效套餐' });

      var days = VIP_PLANS[plan];
      var money = VIP_PRICES[plan];
      var outTradeNo = 'WM' + Date.now() + Math.random().toString(36).substring(2, 8);

      // 构建易支付订单参数
      var payParams = {
        pid: PAY_CONFIG.pid,
        type: 'alipay',
        out_trade_no: outTradeNo,
        notify_url: PAY_CONFIG.notify_url,
        return_url: PAY_CONFIG.return_url,
        name: 'WM优化助手VIP-' + plan + '(' + days + '天)',
        money: money,
        param: email  // 透传邮箱，回调时识别用户
      };
      payParams.sign = makePaySign(payParams, PAY_CONFIG.key);
      payParams.sign_type = 'MD5';

      // 构建支付跳转URL（GET方式提交）
      var qs = Object.keys(payParams).map(function(k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(payParams[k]);
      }).join('&');
      var payUrl = PAY_CONFIG.api + '?' + qs;

      return res.status(200).json({
        success: true,
        orderNo: outTradeNo,
        payUrl: payUrl,
        plan: plan,
        days: days,
        amount: money
      });
    }

    // === 支付回调（易支付异步通知）===
    if (p === '/api/pay/callback' && m === 'GET') {
      // 验证签名
      var callbackParams = {};
      u.searchParams.forEach(function(v, k) { callbackParams[k] = v; });
      var receivedSign = callbackParams.sign;
      delete callbackParams.sign;
      delete callbackParams.sign_type;
      var expectedSign = makePaySign(callbackParams, PAY_CONFIG.key);

      if (receivedSign !== expectedSign) {
        return res.status(200).send('fail');
      }

      var tradeStatus = callbackParams.trade_status;
      if (tradeStatus === 'TRADE_SUCCESS') {
        var userEmail = callbackParams.param;        // 透传的邮箱
        var planName = callbackParams.name || '';
        var daysMatch = planName.match(/\((\d+)天\)/);
        var days = daysMatch ? parseInt(daysMatch[1]) : 30;

        // 查询用户当前VIP到期时间
        var ur = await sbReq('/users?email=eq.' + encodeURIComponent(userEmail) + '&select=vip_expiry', 'GET');
        if (ur.ok && ur.data && ur.data.length > 0) {
          var now = new Date();
          var currentExpiry = ur.data[0].vip_expiry ? new Date(ur.data[0].vip_expiry) : now;
          if (currentExpiry < now) currentExpiry = now;
          var newExpiry = new Date(currentExpiry.getTime() + days * 86400000);

          await sbReq('/users?email=eq.' + encodeURIComponent(userEmail), 'PATCH', {
            vip_expiry: newExpiry.toISOString()
          });
        }
      }
      return res.status(200).send('success');
    }

    // === 查询订单状态（客户端轮询）===
    if (p === '/api/pay/status' && m === 'GET') {
      var orderNo = u.searchParams.get('orderNo');
      if (!orderNo) return res.status(400).json({ error: '缺少orderNo' });
      // 通过查单接口确认支付状态
      var queryParams = { act: 'order', pid: PAY_CONFIG.pid, key: PAY_CONFIG.key, out_trade_no: orderNo };
      var qs2 = Object.keys(queryParams).map(function(k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(queryParams[k]);
      }).join('&');
      var result = await httpGet(PAY_CONFIG.api_mapi + '?' + qs2);
      var isPaid = result.indexOf('success') > -1 || result.indexOf('TRADE_SUCCESS') > -1;
      return res.status(200).json({ paid: isPaid });
    }

    // === 管理员手动激活VIP（供独立后台程序调用）===
    if (p === '/api/admin/activate' && m === 'POST') {
      var adminKey = body.key || '';
      if (adminKey !== 'wm-admin-2026') return res.status(403).json({ error: '无权限' });
      var email = body.email, days = parseInt(body.days) || 30;
      if (!email) return res.status(400).json({ error: '缺少email' });
      var ur = await sbReq('/users?email=eq.' + encodeURIComponent(email) + '&select=vip_expiry', 'GET');
      if (!ur.ok || !ur.data || ur.data.length === 0) return res.status(400).json({ error: '用户不存在' });
      var now = new Date();
      var currentExpiry = ur.data[0].vip_expiry ? new Date(ur.data[0].vip_expiry) : now;
      if (currentExpiry < now) currentExpiry = now;
      var newExpiry = new Date(currentExpiry.getTime() + days * 86400000);
      var pr = await sbReq('/users?email=eq.' + encodeURIComponent(email), 'PATCH', { vip_expiry: newExpiry.toISOString() });
      return res.status(pr.ok ? 200 : 500).json(pr.ok ? { success: true, newExpiry: newExpiry.toISOString() } : { error: '操作失败' });
    }

    // === 版本检查 ===
    if (p === '/api/version') return res.status(200).json({ version: '2.0.1' });

    return res.status(404).json({ error: 'Not Found' });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
