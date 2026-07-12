/**
 * 支付回调中转 - 部署到国内服务器（如腾讯云SCF）
 * ezfpy → 本中转 → Supabase Edge Function
 */
const https = require('https');

exports.main = async (event) => {
  const params = event.queryString || {};
  const qs = Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
  const url = 'https://migbxhwvgcddtlhmqtry.supabase.co/functions/v1/quick-processor?' + qs;

  return new Promise((resolve) => {
    https.get(url, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ statusCode: 200, body: d }));
    }).on('error', () => resolve({ statusCode: 500, body: 'error' }));
  });
};