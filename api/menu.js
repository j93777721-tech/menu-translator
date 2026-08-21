// GET /api/menu?id=xxx — 从 Upstash Redis 读取菜单数据
export const config = { runtime: 'edge' };

async function redisGet(key) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Redis env not configured');

  const res = await fetch(`${url}/get/${key}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`Redis GET failed: ${res.status}`);
  const data = await res.json();
  return data.result;
}

export default async function handler(request) {
  // CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id || !/^[a-z0-9]{4,12}$/.test(id)) {
    return new Response(JSON.stringify({ error: 'Invalid id' }), { status: 400, headers: corsHeaders() });
  }

  try {
    const raw = await redisGet(`menu:${id}`);
    if (!raw) {
      return new Response(JSON.stringify({ error: 'Menu not found' }), { status: 404, headers: corsHeaders() });
    }

    // raw is already a JSON string stored by save.js
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { ...corsHeaders(), 'Cache-Control': 'public, max-age=86400' } // 缓存1天
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders() });
  }
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}
