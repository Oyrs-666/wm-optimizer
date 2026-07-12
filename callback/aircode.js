/**
 * 部署到 AirCode (aircode.cn)
 * ezfpy 回调 → 本函数 → Supabase Edge Function
 */
const https = require('https');

module.exports = async function(params) {
  // ezfpy 回调参数都在 params 里
  const qs = Object.keys(params)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');

  const url = 'https://migbxhwvgcddtlhmqtry.supabase.co/functions/v1/quick-processor?' + qs;

  return new Promise((resolve) => {
    https.get(url, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', () => resolve('fail'));
  });
};