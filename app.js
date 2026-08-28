// 微信读书 · 热门划线摘录
// 自动获取：前端填 infoId -> 本地 server.py 匿名请求 weread.qq.com 接口 -> 渲染热门划线（无需登录）

const STORE_KEY = 'weread_highlights_books';

const fileInput = document.getElementById('fileInput');
const importBtn = document.getElementById('importBtn');
const exportBtn = document.getElementById('exportBtn');
const bookIdInput = document.getElementById('bookIdInput');
const fetchBtn = document.getElementById('fetchBtn');
const fetchStatus = document.getElementById('fetchStatus');
const bookListEl = document.getElementById('bookList');
const bookCountEl = document.getElementById('bookCount');
const emptyHint = document.getElementById('emptyHint');
const bookHeader = document.getElementById('bookHeader');
const highlightList = document.getElementById('highlightList');
const contentEmpty = document.getElementById('contentEmpty');

let books = loadBooks();
let activeBookId = null;

function loadBooks() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch (e) { return []; }
}
function saveBooks() { localStorage.setItem(STORE_KEY, JSON.stringify(books)); }

function chapterMap(data) {
  const m = {};
  (data.chapters || []).forEach(c => { m[c.chapterUid] = c.title; });
  return m;
}

function parseBook(raw, fileName) {
  // 兼容两种结构：标准结构 {items:[...]} 或微信读书原始响应 {bestBookMarks:{items:[...]}}
  const src = raw.bestBookMarks || raw;
  const items = src.items || [];
  const chap = chapterMap(src);
  const bookId = (items[0] && items[0].bookId) || raw.bookId || src.bookId || (fileName || 'unknown');
  let title = raw.title ||
    (raw.bookInfo && raw.bookInfo.title) ||
    (src.bookInfo && src.bookInfo.title) ||
    (fileName && fileName !== 'bestbookmarks.json' ? fileName.replace(/\.json$/, '') : '');
  if (!title) title = '书籍 ' + bookId;
  const highlights = items.map((it, idx) => ({
    text: it.markText || '',
    count: it.totalCount || 0,
    chapter: chap[it.chapterUid] || it.chapterTitle || ('章节' + it.chapterUid),
    chapterUid: it.chapterUid,
    bookmarkId: it.bookmarkId,
    key: it.bookmarkId || ('idx-' + idx)
  }));
  return {
    bookId, infoId: raw.infoId || '',
    title, author: raw.author || '',
    count: highlights.length, highlights, sample: !!raw.__sample
  };
}

// 静默刷新书籍元数据（书名/作者）：旧数据没有书名时自动补全
async function refreshBookMeta(b) {
  if (!b.infoId || (b.title && !/^书籍 /.test(b.title))) return;
  try {
    const r = await fetch('/api/bookmeta?infoId=' + encodeURIComponent(b.infoId), { cache: 'no-store' });
    const d = await r.json();
    if (d.ok && d.title) {
      b.title = d.title;
      b.author = d.author || b.author || '';
      saveBooks();
      renderSidebar();
      if (activeBookId === b.bookId) selectBook(b.bookId);
    }
  } catch (e) { /* 忽略 */ }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  }[c]));
}

function deleteBook(bookId) {
  const b = books.find(x => x.bookId === bookId);
  if (!b) return;
  if (!confirm(`删除《${b.title}》及其全部划线？`)) return;
  books = books.filter(x => x.bookId !== bookId);
  saveBooks();
  if (activeBookId === bookId) {
    activeBookId = null;
    contentEmpty.style.display = 'block';
    bookHeader.classList.add('hidden');
    highlightList.innerHTML = '';
    exportBtn.disabled = true;
  }
  renderSidebar();
}

function renderSidebar() {
  bookCountEl.textContent = books.length;
  emptyHint.style.display = books.length ? 'none' : 'block';
  bookListEl.innerHTML = '';
  books.forEach(b => {
    const li = document.createElement('li');
    li.className = 'book-item' + (b.bookId === activeBookId ? ' active' : '');
    li.innerHTML = `<div class="book-name">${esc(b.title)}${b.sample ? '<span class="tag-sample">示例</span>' : ''}</div>
      <div class="book-meta">${b.author ? esc(b.author) + ' · ' : ''}${b.count} 条热门划线</div>
      <button class="book-del" title="删除这本书">🗑</button>`;
    li.onclick = () => selectBook(b.bookId);
    li.querySelector('.book-del').onclick = (e) => {
      e.stopPropagation();
      deleteBook(b.bookId);
    };
    bookListEl.appendChild(li);
  });
}

function deleteHighlight(bookId, key) {
  const b = books.find(x => x.bookId === bookId);
  if (!b) return;
  if (!confirm('删除这条划线？')) return;
  b.highlights = b.highlights.filter(h => h.key !== key);
  b.count = b.highlights.length;
  saveBooks();
  renderSidebar();
  if (activeBookId === bookId) selectBook(bookId);
}

function selectBook(bookId) {
  activeBookId = bookId;
  const b = books.find(x => x.bookId === bookId);
  renderSidebar();
  if (!b) {
    contentEmpty.style.display = 'block';
    bookHeader.classList.add('hidden');
    highlightList.innerHTML = '';
    exportBtn.disabled = true;
    return;
  }
  contentEmpty.style.display = 'none';
  exportBtn.disabled = false;
  bookHeader.classList.remove('hidden');
  bookHeader.innerHTML = `<h2>${esc(b.title)}</h2>` +
    (b.author ? `<div class="sub-author">${esc(b.author)}</div>` : '') +
    `<div class="sub">共 ${b.count} 条热门划线</div>`;
  highlightList.innerHTML = '';
  b.highlights.forEach((h, i) => {
    const card = document.createElement('div');
    card.className = 'hl-card';
    card.innerHTML = `
      <div class="hl-top">
        <div class="hl-rank">${i + 1}</div>
        <div class="hl-chapter">${esc(h.chapter)}</div>
        <div class="hl-count">${h.count} 人划线</div>
        <button class="hl-del" title="删除这条">🗑</button>
      </div>
      <div class="hl-text">${esc(h.text)}</div>`;
    card.querySelector('.hl-del').onclick = () => deleteHighlight(b.bookId, h.key);
    highlightList.appendChild(card);
  });
}

function addBook(raw, fileName) {
  const b = parseBook(raw, fileName);
  const exist = books.findIndex(x => x.bookId === b.bookId);
  if (exist >= 0) books[exist] = b; else books.push(b);
  saveBooks();
  renderSidebar();
  selectBook(b.bookId);
}

// ---- 自动获取：填 bookId 拉取前 20 条 ----
fetchBtn.onclick = async () => {
  const bookId = bookIdInput.value.trim();
  if (!bookId) { fetchStatus.textContent = '请输入 bookId'; return; }
  fetchStatus.textContent = '获取中…';
  fetchBtn.disabled = true;
  try {
    const r = await fetch('/api/bestbookmarks?bookId=' + encodeURIComponent(bookId), { cache: 'no-store' });
    const d = await r.json();
    if (!r.ok) {
      fetchStatus.textContent = '❌ ' + (d.errmsg || '获取失败') + (d.errcode === -2010 ? '' : '');
      return;
    }
    // 微信读书在登录态/参数错误时返回 {"errcode":-xxxx,"errmsg":"..."}（HTTP 200）
    if (d.errcode != null && d.errcode !== 0) {
      fetchStatus.textContent = '❌ 微信读书返回 ' + d.errcode + '：' + (d.errmsg || '未知错误');
      return;
    }
    if (!d.items || !d.items.length) {
      fetchStatus.textContent = '❌ 返回为空，请确认 bookId 正确（来自 bookDetail URL）';
      return;
    }
    addBook(d, bookId + '.json');
    fetchStatus.textContent = '✅ 已获取 ' + d.items.length + ' 条' + (d.totalCount ? '（共 ' + d.totalCount + ' 条热门）' : '');
  } catch (e) {
    fetchStatus.textContent = '❌ 请求失败，请确认本地工具已启动 (start.bat)';
  } finally {
    fetchBtn.disabled = false;
  }
};
bookIdInput.addEventListener('keydown', e => { if (e.key === 'Enter') fetchBtn.click(); });

// ---- 离线导入 ----
importBtn.onclick = () => fileInput.click();
fileInput.onchange = e => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  let pending = files.length;
  files.forEach(f => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(reader.result);
        // 全量导出文件：{version, books:[...]}（书对象直接使用）
        if (raw && Array.isArray(raw.books) && raw.version) {
          let added = 0;
          raw.books.forEach(b => {
            if (b && b.bookId && Array.isArray(b.highlights)) {
              const exist = books.findIndex(x => x.bookId === b.bookId);
              if (exist >= 0) books[exist] = b; else books.push(b);
              added++;
            }
          });
          saveBooks();
          renderSidebar();
          if (added && books.length) selectBook(books[0].bookId);
          alert('✅ 已导入 ' + added + ' 本书');
        } else {
          addBook(raw, f.name);
        }
      } catch (err) {
        alert('解析失败：' + f.name + '\n' + err.message);
      } finally {
        if (--pending === 0) fileInput.value = '';
      }
    };
    reader.readAsText(f);
  });
};

function toText(b) {
  const lines = [];
  lines.push(`热门划线（按热度排序，共 ${b.count} 条）`);
  lines.push(`书名：${b.title}`);
  lines.push('');
  b.highlights.slice(0, 20).forEach((h, i) => {
    lines.push(`${i + 1}. 【${h.chapter}】· ${h.count} 人划线`);
    lines.push('> ' + h.text);
    lines.push('');
  });
  return lines.join('\n');
}

function toMarkdown(b) {
  let s = `# ${b.title}\n\n> 热门划线（按热度排序，共 ${b.count} 条）\n\n`;
  b.highlights.slice(0, 20).forEach((h, i) => {
    s += `### ${i + 1}. ${h.chapter} · ${h.count} 人划线\n\n> ${h.text}\n\n`;
  });
  return s;
}

function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

exportBtn.onclick = () => {
  const b = books.find(x => x.bookId === activeBookId);
  if (!b) return;
  download(b.title + '_热门划线.txt', toText(b), 'text/plain;charset=utf-8');
  download(b.title + '_热门划线.md', toMarkdown(b), 'text/markdown;charset=utf-8');
};

// ---- 导出全部：单个 JSON 文件（含所有书，可再次导入） ----
const exportAllBtn = document.getElementById('exportAllBtn');
exportAllBtn.onclick = () => {
  if (!books.length) { alert('还没有任何书籍'); return; }
  const payload = {
    version: 1,
    exportedAt: new Date().toLocaleString('zh-CN'),
    app: '微信读书热门划线摘录',
    books: books.map(b => ({
      bookId: b.bookId,
      infoId: b.infoId || '',
      title: b.title || '',
      author: b.author || '',
      highlights: b.highlights || []
    }))
  };
  download('全部热门划线.json', JSON.stringify(payload, null, 2), 'application/json');
};

// 启动
(async () => {
  renderSidebar();
  if (activeBookId) {
    selectBook(activeBookId);
  }
  // 静默补全旧数据的书名/作者
  books.forEach(b => refreshBookMeta(b));
})();
