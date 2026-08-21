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

async function redisSet(key, value) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Redis env not configured');

  const res = await fetch(`${url}/set/${key}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
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

    // Generate unique short ID (retry on collision)
    let id;
    for (let i = 0; i < 5; i++) {
      id = generateId(6);
      const exists = await redisExists(`menu:${id}`);
      if (!exists) break;
    }

    // Store with no expiry (restaurant QR should be permanent)
    await redisSet(`menu:${id}`, JSON.stringify(body.data));

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
