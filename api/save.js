// POST /api/save — 存菜单数据到 Upstash Redis，返回短 ID
export const config = { runtime: 'edge' };

function generateId(len = 6) {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789'; // 去掉容易混淆的字符
  let id = '';
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) id += chars[arr[i] % chars.length];
  return id;
}

async function redisSet(key, jsonString) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Redis env not configured');

  // 注意：jsonString 已经是序列化好的 JSON 字符串，这里不能再 JSON.stringify，
  // 否则会双重编码，读出来的 data 是字符串而不是对象（扫码会得到空菜单）。
  const res = await fetch(`${url}/set/${key}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: jsonString
  });
  if (!res.ok) throw new Error(`Redis SET failed: ${res.status}`);
  return res.json();
}

async function redisExists(key) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  const res = await fetch(`${url}/exists/${key}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  return data.result === 1;
}

export default async function handler(request) {
  // CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: corsHeaders() });
  }

  try {
    const body = await request.json();
    if (!body || !body.data) {
      return new Response(JSON.stringify({ error: 'Missing data field' }), { status: 400, headers: corsHeaders() });
    }

    // Payload size guard (~500KB max)
    const payload = JSON.stringify(body.data);
    if (payload.length > 512000) {
      return new Response(JSON.stringify({ error: 'Payload too large' }), { status: 413, headers: corsHeaders() });
    }

    // Generate unique short ID (retry on collision, 8 chars for more entropy)
    let id;
    let unique = false;
    for (let i = 0; i < 8; i++) {
      id = generateId(8);
      const exists = await redisExists(`menu:${id}`);
      if (!exists) { unique = true; break; }
    }
    if (!unique) {
      return new Response(JSON.stringify({ error: 'ID generation failed, try again' }), { status: 503, headers: corsHeaders() });
    }

    // Store with no expiry (restaurant QR should be permanent)
    await redisSet(`menu:${id}`, payload);

    return new Response(JSON.stringify({ id }), { status: 200, headers: corsHeaders() });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders() });
  }
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}
