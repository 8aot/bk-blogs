async function verifyPassword(password, env) {
  try {
    const row = await env.DB.prepare("SELECT value FROM config WHERE key = 'admin_password'").first();
    if (row && row.value) return password === row.value;
  } catch (e) {}
  return password === env.ADMIN_PASSWORD;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // 1. GET：支持分页、搜索、分类过滤，以及热门排行榜
  if (request.method === "GET") {
    try {
      const q = url.searchParams.get("q");
      const category = url.searchParams.get("category");
      const popularLimit = url.searchParams.get("popular");

      // A. 如果是请求热门排行，无需分页
      if (popularLimit) {
        const limit = parseInt(popularLimit) || 5;
        const { results } = await env.DB.prepare(
          "SELECT id, title, date, views, cover FROM posts ORDER BY views DESC LIMIT ?"
        ).bind(limit).all();
        return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json" } });
      }

      // B. 标准列表（加入 SQL 分页逻辑）
      const page = parseInt(url.searchParams.get("page")) || 1;
      const limit = parseInt(url.searchParams.get("limit")) || 12; // 默认每页 12 篇
      const offset = (page - 1) * limit;

      let whereClause = "";
      let params = [];
      let conditions = [];

      if (q) {
        conditions.push("(title LIKE ? OR summary LIKE ?)");
        params.push(`%${q}%`, `%${q}%`);
      }
      if (category) {
        conditions.push("category = ?");
        params.push(category);
      }

      if (conditions.length > 0) {
        whereClause = " WHERE " + conditions.join(" AND ");
      }

      // 1. 统计总条数
      const countResult = await env.DB.prepare(
        `SELECT COUNT(*) as count FROM posts ${whereClause}`
      ).bind(...params).first();
      const total = countResult ? countResult.count : 0;

      // 2. 查询分页数据
      let query = `SELECT id, title, summary, date, views, category, cover FROM posts ${whereClause} ORDER BY date DESC LIMIT ? OFFSET ?`;
      const { results } = await env.DB.prepare(query).bind(...params, limit, offset).all();

      // 返回包含分页元数据的 JSON 对象
      return new Response(JSON.stringify({
        results,
        total,
        page,
        limit
      }), { headers: { "Content-Type": "application/json" } });

    } catch (err) {
      return new Response(err.message, { status: 500 });
    }
  }

  // 2. POST：保存文章
  if (request.method === "POST") {
    const authHeader = request.headers.get("Authorization");
    if (!(await verifyPassword(authHeader, env))) {
      return new Response("Unauthorized", { status: 401 });
    }

    try {
      const { id, title, summary, content, date, category, cover } = await request.json();

      await env.MY_BUCKET.put(`posts/${id}.md`, content, {
        httpMetadata: { contentType: "text/markdown; charset=utf-8" }
      });

      await env.DB.prepare(`
        INSERT INTO posts (id, title, summary, date, category, cover, views) VALUES (?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(id) DO UPDATE SET title = ?, summary = ?, category = ?, cover = ?
      `).bind(id, title, summary, date, category || '未分类', cover || '', title, summary, category || '未分类', cover || '').run();

      return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
    } catch (err) {
      return new Response(err.message, { status: 500 });
    }
  }

  return new Response("Method not allowed", { status: 405 });
}
