// Vercel serverless 代理：匿名抓取微信读书热门划线（免登录）
// 部署方式：Vercel 导入本仓库 → 自动识别 api/ 目录 → 得到 https://<项目名>.vercel.app
// 前端访客模式调用：https://<项目名>.vercel.app/api/weread?bookId=<infoId 或数字 bookId>
// 返回结构与本地 server.py 的 /api/bestbookmarks 完全一致。
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const DETAIL_URL = 'https://weread.qq.com/web/bookDetail/';
const BESTBOOK_URL = 'https://weread.qq.com/web/book/bestbookmarks';

function decodeStr(s) {
  if (!s) return '';
  try {
    // 形如 \u4e00 的 Unicode 转义 -> 真实字符
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

module.exports = async (req, res) => {
  // 允许任意来源跨域调用（GitHub Pages / 本地 127.0.0.1）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') {
    res.status(405).json({ errcode: -1, errmsg: '仅支持 GET' });
    return;
  }

  const infoId = String(req.query.bookId || req.query.infoId || '').trim();
  if (!infoId) {
    res.status(400).json({ errcode: -1, errmsg: 'bookId/infoId 必填' });
    return;
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

    const body = await fetchText(BESTBOOK_URL + '?bookId=' + bookId + '&hasLogin=0', DETAIL_URL + infoId);
    const raw = JSON.parse(body);
    if (raw.errcode != null && raw.errcode !== 0) {
      res.status(200).json({ errcode: raw.errcode, errmsg: raw.errmsg || '微信读书接口错误' });
      return;
    }
    res.status(200).json(normalize(raw, bookId, infoId, title, author));
  } catch (e) {
    res.status(500).json({ errcode: -1, errmsg: String(e.message || e).slice(0, 300) });
  }
};
