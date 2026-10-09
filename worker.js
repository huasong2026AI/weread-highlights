// Cloudflare Worker 代理：匿名抓取微信读书热门划线（免登录）
// 部署：Cloudflare 网页 → Workers & Pages → Create Worker → 粘贴本文件内容 → Deploy
// 部署后得到: https://<你的worker名>.<你的子域>.workers.dev
// 调用方式: https://<worker域名>/api/weread?bookId=<infoId 或数字 bookId>
// 返回结构与本地 server.py 的 /api/bestbookmarks 完全一致，并带 CORS 头供 GitHub Pages 跨域调用。

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const DETAIL_URL = 'https://weread.qq.com/web/bookDetail/';
const BESTBOOK_URL = 'https://weread.qq.com/web/book/bestbookmarks';
// 每本书取热度前 N 条热门划线。接口不传 count 时默认只给 10 条。
const FETCH_COUNT = 30;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

function decodeStr(s) {
  if (!s) return '';
  try {
    return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  } catch (e) {
    return s;
  }
}

async function fetchText(url, referer) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  };
  if (referer) headers['Referer'] = referer;
  const r = await fetch(url, { headers, redirect: 'follow' });
  return await r.text();
}

// 与 server.py fetch_book_detail_info 相同逻辑：详情页提 bookId/书名/作者
async function fetchBookDetail(infoId) {
  const html = await fetchText(DETAIL_URL + infoId);
  const safe = String(infoId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let m = html.match(new RegExp('"reader"\\s*:\\s*\\{[^{}]*?"infoId"\\s*:\\s*"' + safe + '"[^{}]*?"bookId"\\s*:\\s*"(\\d+)"'));
  if (!m) {
    const all = html.match(/"bookId"\s*:\s*"(\d+)"/);
    if (all) m = all;
  }
  const bookId = m ? m[1] : null;
  const tm = html.match(/"bookInfo"\s*:\s*\{[^{}]*?"title"\s*:\s*"(.*?)"/);
  const am = html.match(/"bookInfo"\s*:\s*\{[^{}]*?"author"\s*:\s*"(.*?)"/);
  return {
    bookId,
    title: tm ? decodeStr(tm[1]) : '',
    author: am ? decodeStr(am[1]) : '',
  };
}

// 与 server.py fetch_via_anonymous 相同：归一化 bestbookmarks 响应
function normalize(raw, bookId, infoId, title, author) {
  const bb = raw.bestBookMarks || {};
  const chapters = bb.chapters || [];
  const chapMap = {};
  chapters.forEach(c => { chapMap[c.chapterUid] = c.title || ''; });
  const items = (bb.items || []).map(it => ({
    bookId: it.bookId,
    markText: it.markText || '',
    totalCount: it.totalCount || 0,
    chapterUid: it.chapterUid,
    chapterTitle: chapMap[it.chapterUid] || '',
    bookmarkId: it.bookmarkId,
    users: it.users || [],
  }));
  return {
    bookId, infoId, title, author,
    totalCount: bb.totalCount,
    count: items.length,
    items, chapters,
  };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== 'GET') {
      return json({ errcode: -1, errmsg: '仅支持 GET' }, 405);
    }

    const infoId = String(url.searchParams.get('bookId') || url.searchParams.get('infoId') || '').trim();
    if (!infoId) {
      return json({ errcode: -1, errmsg: 'bookId/infoId 必填' }, 400);
    }

    try {
      // 纯数字直接当 bookId，否则从详情页提取
      let bookId = /^\d+$/.test(infoId) ? infoId : null;
      let title = '', author = '';
      if (!bookId) {
        const detail = await fetchBookDetail(infoId);
        bookId = detail.bookId;
        title = detail.title;
        author = detail.author;
      }
      if (!bookId) throw new Error('无法从详情页提取 bookId');

      // 必须显式传 count，否则接口默认只返回 10 条
      // （顺带记录：maxIdx 实测无效，无论传多少都返回从第一条开始的前 N 条）
      const raw = JSON.parse(await fetchText(
        BESTBOOK_URL + '?bookId=' + bookId + '&hasLogin=0&count=' + FETCH_COUNT, DETAIL_URL + infoId));
      if (raw.errcode != null && raw.errcode !== 0) {
        return json({ errcode: raw.errcode, errmsg: raw.errmsg || '微信读书接口错误' });
      }
      return json(normalize(raw, bookId, infoId, title, author));
    } catch (e) {
      return json({ errcode: -1, errmsg: String(e.message || e).slice(0, 300) }, 500);
    }
  },
};
