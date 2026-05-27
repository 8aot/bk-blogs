export async function onRequestPost(context) {
  const { request, env } = context;
  const authHeader = request.headers.get("Authorization");

  if (authHeader !== env.ADMIN_PASSWORD) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const { id } = await request.json();

    // A. 从 R2 物理删除 Markdown 文件
    await env.MY_BUCKET.delete(`posts/${id}.md`);

    // B. 从 D1 数据库删除文章元数据
    await env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(id).run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(err.message, { status: 500 });
  }
}
