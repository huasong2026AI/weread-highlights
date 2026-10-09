// 微信读书 · 热门划线摘录
// 自动获取：前端填 infoId -> 本地 server.py 匿名请求 weread.qq.com 接口 -> 渲染热门划线（无需登录）

const STORE_KEY = 'weread_highlights_books';
// 每本书取热度前 N 条热门划线。接口不传 count 时默认只给 10 条。
const FETCH_COUNT = 30;

const fileInput = document.getElementById('fileInput');
const importBtn = document.getElementById('importBtn');
const bookIdInput = document.getElementById('bookIdInput');
const fetchBtn = document.getElementById('fetchBtn');
const fetchStatus = document.getElementById('fetchStatus');
const bookListEl = document.getElementById('bookList');
const bookCountEl = document.getElementById('bookCount');
const emptyHint = document.getElementById('emptyHint');
const bookHeader = document.getElementById('bookHeader');
const highlightList = document.getElementById('highlightList');
const contentScroll = document.getElementById('contentScroll');
const contentEmpty = document.getElementById('contentEmpty');
const libStatusEl = document.getElementById('libStatus');
const infoPanel = document.getElementById('infoPanel');

// 内容区视图：'hl' = 划线句子，'info' = 简介 · 读后感（书名旁的按钮切换）
let activeTab = 'hl';

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
  // 兼容结构：导出的单个书籍对象、标准结构 {items:[...]} 或微信读书原始响应 {bestBookMarks:{items:[...]}}
  const src = raw.book || raw.bestBookMarks || raw;
  const items = src.highlights || src.items || [];
  const chap = chapterMap(src);
  const bookId = (items[0] && items[0].bookId) || src.bookId || raw.bookId || (fileName || 'unknown');
  let title = src.title || raw.title ||
    (raw.bookInfo && raw.bookInfo.title) ||
    (src.bookInfo && src.bookInfo.title) ||
    (fileName && fileName !== 'bestbookmarks.json' ? fileName.replace(/\.json$/, '') : '');
  if (!title) title = '书籍 ' + bookId;
  const highlights = items.map((it, idx) => ({
    text: it.text || it.markText || '',
    count: it.count || it.totalCount || 0,
    chapter: it.chapter || chap[it.chapterUid] || it.chapterTitle || ('章节' + (it.chapterUid || idx + 1)),
    chapterUid: it.chapterUid,
    bookmarkId: it.bookmarkId || it.key,
    key: it.key || it.bookmarkId || ('idx-' + idx)
  }));
  return {
    bookId, infoId: src.infoId || raw.infoId || '',
    title, author: src.author || raw.author || '',
    // 书籍扩展信息（简介 / 评分 / 最受推荐的读后感），从 data/books.json 或本地接口带入
    intro: src.intro || raw.intro || '',
    rating: (src.rating != null) ? src.rating : (raw.rating != null ? raw.rating : null),
    ratingCount: src.ratingCount || raw.ratingCount || null,
    category: src.category || raw.category || '',
    publisher: src.publisher || raw.publisher || '',
    publishTime: src.publishTime || raw.publishTime || '',
    cover: src.cover || raw.cover || '',
    deepLink: src.deepLink || raw.deepLink || '',
    reviewCount: src.reviewCount || raw.reviewCount || null,
    topReview: src.topReview || raw.topReview || null,
    count: highlights.length, highlights, sample: !!raw.__sample
  };
}

// 静默刷新书籍元数据（书名/作者）：旧数据没有书名或存在异常编码时自动补全
async function refreshBookMeta(b) {
  if (!b.infoId || visitorMode) return; // 访客模式不打公共代理，避免大量请求
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
    if (infoPanel) infoPanel.innerHTML = '';
    highlightList.classList.add('hidden');
    if (infoPanel) infoPanel.classList.add('hidden');
  }
  renderSidebar();
}

// 书籍列表排列：按书名或作者（中文拼音序），选择会记住
const SORT_KEY = 'weread_sort_mode';
const sortSelect = document.getElementById('sortSelect');
sortSelect.value = localStorage.getItem(SORT_KEY) || 'title';

function sortBooks() {
  const byAuthor = sortSelect.value === 'author';
  books.sort((a, b) => {
    const cmp = byAuthor
      ? String(a.author || '').localeCompare(String(b.author || ''), 'zh-CN')
      : String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN');
    if (cmp !== 0) return cmp;
    return String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN');
  });
}

sortSelect.onchange = () => {
  localStorage.setItem(SORT_KEY, sortSelect.value);
  renderSidebar();
};

function renderSidebar() {
  sortBooks();
  bookCountEl.textContent = books.length;
  emptyHint.style.display = books.length ? 'none' : 'block';
  bookListEl.innerHTML = '';
  books.forEach(b => {
    const li = document.createElement('li');
    li.className = 'book-item' + (b.bookId === activeBookId ? ' active' : '');
    li.innerHTML = `<div class="book-name">${esc(b.title)}${b.sample ? '<span class="tag-sample">示例</span>' : ''}</div>
      <div class="book-meta">${esc(b.author || '')}</div>
      <button class="book-del" title="删除这本书">🗑</button>`;
    li.onclick = () => selectBook(b.bookId);
    li.querySelector('.book-del').onclick = (e) => {
      e.stopPropagation();
      deleteBook(b.bookId);
    };
    bookListEl.appendChild(li);
  });
}

// ---- 删除清单（用于「同步共享书库」）----
const DELETED_KEY = 'weread_deleted_highlights';

function loadDeletedMap() {
  try { return JSON.parse(localStorage.getItem(DELETED_KEY)) || {}; } catch (e) { return {}; }
}
function saveDeletedMap(m) { localStorage.setItem(DELETED_KEY, JSON.stringify(m)); }

function deleteHighlight(bookId, key) {
  const b = books.find(x => x.bookId === bookId);
  if (!b) return;
  if (!confirm('删除这条划线？\n（点「同步共享书库」后，网页上的所有人也会看不到它）')) return;
  b.highlights = b.highlights.filter(h => h.key !== key);
  b.count = b.highlights.length;
  // 记录到删除清单
  const dm = loadDeletedMap();
  (dm[bookId] = dm[bookId] || []).push(key);
  saveDeletedMap(dm);
  saveBooks();
  renderSidebar();
  if (activeBookId === bookId) selectBook(bookId);
  syncStatus.textContent = '⚠️ 有本地删除待同步，点「同步共享书库」发布';
}

// ---- 右栏：书籍简介 · 最受推荐的读后感 ----
function starsOf(star) {
  const n = Math.max(0, Math.min(5, Math.round((star || 0) / 20)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  if (isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function renderBookInfo(b) {
  if (!infoPanel) return;
  const tags = [b.category, b.publisher, b.publishTime].filter(Boolean);
  const tr = b.topReview;

  infoPanel.innerHTML =
    // 书籍基本信息
    `<div class="info-card">
      <div class="info-book">
        ${b.cover ? `<img class="info-cover" src="${esc(b.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ''}
        <div class="info-bookmeta">
          <div class="info-btitle">${esc(b.title || '')}</div>
          ${b.author ? `<div class="info-author">${esc(b.author)}</div>` : ''}
          ${b.rating ? `<div class="info-rating"><b>${esc(String(b.rating))}%</b>
            <span class="review-meta">推荐值${b.ratingCount ? ' · ' + b.ratingCount + ' 人评分' : ''}</span></div>` : ''}
          ${tags.length ? `<div class="info-tags">${tags.map(t => `<span class="info-tag">${esc(t)}</span>`).join('')}</div>` : ''}
        </div>
      </div>
      ${b.deepLink ? `<a class="info-link" href="${esc(b.deepLink)}" target="_blank" rel="noopener">在微信读书中打开</a>` : ''}
    </div>` +
    // 简介
    `<div class="info-card">
      <div class="info-sec-title">书籍简介</div>
      ${b.intro
        ? `<div class="info-intro clamped" id="introText">${esc(b.intro)}</div>
           <div class="info-more" id="introMore">展开全文 ▾</div>`
        : `<div class="info-empty">暂无简介数据。<br />本地运行 <code>scripts/refresh_books.py</code> 可补齐。</div>`}
    </div>` +
    // 最受推荐的读后感
    `<div class="info-card">
      <div class="info-sec-title">最受推荐的读后感${b.reviewCount ? `<span class="cnt">（共 ${b.reviewCount} 条点评）</span>` : ''}</div>
      ${tr ? `
        <div class="review-author">
          <span class="review-name">${esc(tr.author || '匿名读者')}</span>
          ${tr.isDeepV ? '<span class="review-badge">资深会员</span>' : ''}
          <span class="info-stars">${starsOf(tr.star)}</span>
          <span class="review-meta">${tr.isFinish ? '读完了' : '在读'}${tr.createTime ? ' · ' + fmtDate(tr.createTime) : ''}</span>
        </div>
        <div class="review-text">${esc(tr.content || '')}${tr.truncated ? '…' : ''}</div>
        <div class="review-meta" style="margin-top:10px">取自微信读书默认「热门」排序的第一条（该接口不提供点赞数）。</div>`
        : `<div class="info-empty">暂无公开点评数据。</div>`}
    </div>`;

  // 简介折叠 / 展开
  const more = document.getElementById('introMore');
  const intro = document.getElementById('introText');
  if (more && intro) {
    more.onclick = () => {
      const clamped = intro.classList.toggle('clamped');
      more.textContent = clamped ? '展开全文 ▾' : '收起 ▴';
    };
  }
}

// 按当前选中的视图，切换「划线句子 / 简介」两个面板的显示
function applyTab() {
  document.querySelectorAll('.bh-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === activeTab);
  });
  if (!activeBookId) return;
  highlightList.classList.toggle('hidden', activeTab !== 'hl');
  infoPanel.classList.toggle('hidden', activeTab !== 'info');
  if (contentScroll) contentScroll.scrollTop = 0;
}

// 本地模式下，若某本书还缺简介/读后感（新加的书或旧数据），即时补一次
const extraTried = new Set();
async function ensureBookExtra(b) {
  if (!b || visitorMode || !b.bookId || extraTried.has(b.bookId)) return;
  if (b.intro && b.topReview) return;
  extraTried.add(b.bookId);
  try {
    const r = await fetch('/api/bookextra?bookId=' + encodeURIComponent(b.bookId), { cache: 'no-store' });
    const d = await r.json();
    if (!d || !d.ok) return;
    let changed = false;
    ['intro', 'rating', 'ratingCount', 'category', 'publisher', 'publishTime', 'cover', 'deepLink', 'reviewCount', 'topReview']
      .forEach(k => {
        const v = d[k];
        if (v !== undefined && v !== null && v !== '') { b[k] = v; changed = true; }
      });
    if (changed) {
      saveBooks();
      if (activeBookId === b.bookId) renderBookInfo(b);
    }
  } catch (e) { /* 无 Key 或离线时静默跳过 */ }
}

function selectBook(bookId) {
  activeBookId = bookId;
  const b = books.find(x => x.bookId === bookId);
  renderSidebar();
  if (!b) {
    contentEmpty.style.display = 'block';
    bookHeader.classList.add('hidden');
    highlightList.innerHTML = '';
    infoPanel.innerHTML = '';
    highlightList.classList.add('hidden');
    infoPanel.classList.add('hidden');
    return;
  }
  contentEmpty.style.display = 'none';
  bookHeader.classList.remove('hidden');
  const hlCount = (b.highlights || []).length;
  bookHeader.innerHTML =
    `<div class="bh-line">
      <h2>${esc(b.title)}</h2>
      <div class="bh-tabs" role="tablist">
        <button class="bh-tab" data-tab="hl" role="tab" title="查看这本书的热门划线句子">划线句子<span class="bh-num">${hlCount}</span></button>
        <button class="bh-tab" data-tab="info" role="tab" title="查看书籍简介与最受推荐的读后感">简介</button>
      </div>
    </div>` +
    (b.author ? `<div class="sub-author">${esc(b.author)}</div>` : '');
  bookHeader.querySelectorAll('.bh-tab').forEach(btn => {
    btn.onclick = () => { activeTab = btn.dataset.tab; applyTab(); };
  });
  highlightList.innerHTML = '';
  b.highlights.forEach((h, i) => {
    const card = document.createElement('div');
    const isThisSpeaking = isPlaying && currentPlayingBookId === b.bookId && currentPlayingHlIdx === i;
    card.className = 'hl-card' + (isThisSpeaking ? ' speaking' : '');
    card.id = 'hl-card-' + b.bookId + '-' + i;
    card.innerHTML = `
      <div class="hl-top">
        <div class="hl-rank">${i + 1}</div>
        <div class="hl-chapter">${esc(h.chapter)}</div>
        <div class="hl-count">${h.count} 人划线</div>
        <button class="hl-play-single" title="朗读此条">🔊 朗读</button>
        <button class="hl-del" title="删除这条">🗑</button>
      </div>
      <div class="hl-text">${esc(h.text)}</div>`;
    card.querySelector('.hl-play-single').onclick = (e) => {
      e.stopPropagation();
      playFromSpecific(b.bookId, i);
    };
    card.querySelector('.hl-del').onclick = (e) => {
      e.stopPropagation();
      deleteHighlight(b.bookId, h.key);
    };
    highlightList.appendChild(card);
  });
  // 简介 + 最受推荐的读后感（先渲染好，点按钮即可切换）
  renderBookInfo(b);
  ensureBookExtra(b);
  applyTab();
}

function addBook(raw, fileName) {
  const b = parseBook(raw, fileName);
  const exist = books.findIndex(x => x.bookId === b.bookId);
  if (exist >= 0) books[exist] = b; else books.push(b);
  saveBooks();
  renderSidebar();
  selectBook(b.bookId);
}

// ---- 自动获取：填 bookId 拉取全部热门划线 ----
fetchBtn.onclick = async () => {
  const bookId = bookIdInput.value.trim();
  if (!bookId) { fetchStatus.textContent = '请输入 bookId'; return; }
  fetchStatus.textContent = visitorMode ? '获取中（访客通道）…' : '获取中…';
  fetchBtn.disabled = true;
  try {
    let d;
    if (visitorMode) {
      d = await visitorFetchBook(bookId);
    } else {
      const r = await fetch('/api/bestbookmarks?bookId=' + encodeURIComponent(bookId), { cache: 'no-store' });
      d = await r.json();
      if (!r.ok) {
        fetchStatus.textContent = '❌ ' + (d.errmsg || '获取失败') + (d.errcode === -2010 ? '' : '');
        return;
      }
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
    fetchStatus.textContent = visitorMode
      ? '❌ 获取失败，请稍后再试；或先用「导入 JSON」加书'
      : '❌ 请求失败，请确认本地工具已启动 (start.bat)';
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

function download(name, content, type = 'application/json;charset=utf-8') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// 导出全部书籍为单个 JSON
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
      count: b.highlights ? b.highlights.length : 0,
      highlights: b.highlights || []
    }))
  };
  download('全部热门划线.json', JSON.stringify(payload, null, 2));
};

// ==========================================
// 🔊 全局连续朗读（TTS）播放系统
// ==========================================
const playerBookTitle = document.getElementById('playerBookTitle');
const playerDetail = document.getElementById('playerDetail');
const playBtn = document.getElementById('playBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const stopBtn = document.getElementById('stopBtn');
const rateSelect = document.getElementById('rateSelect');
const playModeSelect = document.getElementById('playModeSelect');

const synth = window.speechSynthesis;
let isPlaying = false;
let isPaused = false;
let currentPlayingBookId = null;
let currentPlayingHlIdx = 0;
let currentUtterance = null;
let keepAliveTimer = null;

function getChineseVoice() {
  if (!synth) return null;
  const voices = synth.getVoices() || [];
  const zhVoices = voices.filter(v => v.lang && (v.lang.startsWith('zh') || v.lang.includes('CN') || v.lang.includes('TW')));
  return zhVoices.find(v => /Xiaoxiao|Yunxi|Natural|Chinese|Mandarin/i.test(v.name)) || zhVoices[0] || null;
}

if (synth && synth.onvoiceschanged !== undefined) {
  synth.onvoiceschanged = () => getChineseVoice();
}

function updateActiveCardVisual() {
  document.querySelectorAll('.hl-card').forEach(card => card.classList.remove('speaking'));
  if (isPlaying && currentPlayingBookId) {
    const activeCard = document.getElementById('hl-card-' + currentPlayingBookId + '-' + currentPlayingHlIdx);
    if (activeCard) {
      activeCard.classList.add('speaking');
      activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
}

function updatePlayerUI(statusText) {
  if (!isPlaying) {
    playBtn.textContent = '▶ 播放';
    playBtn.classList.remove('playing');
    playerBookTitle.textContent = books.length ? '准备就绪' : '暂无书籍';
    playerDetail.textContent = statusText || '点击播放开启连读';
    return;
  }
  if (isPaused) {
    playBtn.textContent = '▶ 继续';
    playBtn.classList.remove('playing');
    playerDetail.textContent = '已暂停 · 点击继续';
    return;
  }
  playBtn.textContent = '⏸ 暂停';
  playBtn.classList.add('playing');
  const b = books.find(x => x.bookId === currentPlayingBookId);
  if (b) {
    playerBookTitle.textContent = `《${b.title}》` + (b.author ? ` · ${b.author}` : '');
    const hl = b.highlights[currentPlayingHlIdx];
    playerDetail.textContent = `第 ${currentPlayingHlIdx + 1}/${b.highlights.length} 条` + (hl && hl.chapter ? `（${hl.chapter}）` : '');
  }
}

function playHighlight(bookIndex, hlIndex) {
  if (!synth) { alert('当前浏览器不支持语音合成 (Web Speech API)'); return; }
  if (bookIndex < 0 || bookIndex >= books.length) { stopPlay('所有书籍朗读完毕'); return; }

  const book = books[bookIndex];
  if (!book.highlights || !book.highlights.length) {
    if (playModeSelect.value === 'all' && bookIndex + 1 < books.length) { playHighlight(bookIndex + 1, 0); } else { stopPlay('朗读完成'); }
    return;
  }

  if (hlIndex >= book.highlights.length) {
    if (playModeSelect.value === 'all') {
      if (bookIndex + 1 < books.length) { playHighlight(bookIndex + 1, 0); } else { stopPlay('所有书已朗读完毕 🎉'); }
    } else { stopPlay('当前书朗读完毕'); }
    return;
  }

  isPlaying = true;
  isPaused = false;
  currentPlayingBookId = book.bookId;
  currentPlayingHlIdx = hlIndex;

  if (activeBookId !== book.bookId) { selectBook(book.bookId); } else { updateActiveCardVisual(); }
  updatePlayerUI();

  const hl = book.highlights[hlIndex];
  // 拼接朗读文案：每本书第1条带上书名，后续直接朗读划线正文（不朗读章节名称）
  let speakText = '';
  if (hlIndex === 0) { speakText += `开始朗读：《${book.title}》` + (book.author ? `，作者：${book.author}` : '') + '。'; }
  speakText += hl.text;

  // 关键：把长文本切成短句分块排队播放，规避 Chrome 长语音被静默掐断的 bug
  const chunks = splitTextIntoChunks(speakText, 60);
  currentChunks = chunks;
  currentChunkIdx = 0;
  currentBookIndex = bookIndex;
  startWatchdog();
  speakChunk(bookIndex, hlIndex, 0, chunks);
}

// 把文本按标点切分成短句，超长句子再硬切，每块不超过 maxLen 个字
function splitTextIntoChunks(text, maxLen = 60) {
  const sentences = text.split(/(?<=[。！？；!?;\n])/);
  const chunks = [];
  let buf = '';
  const pushBuf = () => { if (buf.trim()) chunks.push(buf); buf = ''; };
  for (const s of sentences) {
    if (!s) continue;
    if ((buf + s).length <= maxLen) { buf += s; continue; }
    pushBuf();
    if (s.length <= maxLen) { buf = s; continue; }
    for (let i = 0; i < s.length; i += maxLen) {
      const piece = s.slice(i, i + maxLen);
      if (i + maxLen < s.length) chunks.push(piece); else buf = piece;
    }
  }
  pushBuf();
  return chunks.length ? chunks : [text];
}

let currentChunks = [];
let currentChunkIdx = 0;
let currentBookIndex = 0;
let lastSpeakActivity = Date.now();

// 朗读一个分块；读完自动接下一块，全部读完接下一条划线
function speakChunk(bookIndex, hlIndex, chunkIdx, chunks) {
  if (!isPlaying || isPaused) return;
  if (chunkIdx >= chunks.length) { playHighlight(bookIndex, hlIndex + 1); return; }

  const utter = new SpeechSynthesisUtterance(chunks[chunkIdx]);
  utter.rate = parseFloat(rateSelect.value) || 1.0;
  utter.lang = 'zh-CN';
  utter.voice = getChineseVoice();

  utter.onstart = () => { lastSpeakActivity = Date.now(); };
  utter.onend = () => {
    lastSpeakActivity = Date.now();
    if (isPlaying && !isPaused) speakChunk(bookIndex, hlIndex, chunkIdx + 1, chunks);
  };
  utter.onerror = (e) => {
    lastSpeakActivity = Date.now();
    if (e.error !== 'interrupted' && e.error !== 'canceled' && isPlaying && !isPaused) speakChunk(bookIndex, hlIndex, chunkIdx + 1, chunks);
  };

  currentChunkIdx = chunkIdx;
  currentUtterance = utter;
  // Chrome bug：cancel() 后同一帧 speak() 会被吞掉，延迟一小段时间再开口
  if (chunkIdx === 0) {
    synth.cancel();
    setTimeout(() => { if (isPlaying && !isPaused) synth.speak(utter); }, 80);
  } else {
    synth.speak(utter);
  }
}

// 看门狗：每2秒检查一次，若播放被浏览器静默杀掉（不在说也不在排队），3秒后自动从当前条目续播
function startWatchdog() {
  clearInterval(keepAliveTimer);
  lastSpeakActivity = Date.now();
  keepAliveTimer = setInterval(() => {
    if (!isPlaying || isPaused) return;
    if (!synth.speaking && !synth.pending && !synth.paused) {
      if (Date.now() - lastSpeakActivity > 3000) {
        lastSpeakActivity = Date.now();
        playHighlight(currentBookIndex, currentPlayingHlIdx);
      }
    } else {
      lastSpeakActivity = Date.now();
    }
  }, 2000);
}

function startPlay() {
  if (!books.length) { alert('暂无书籍'); return; }
  if (isPaused && synth.paused) { isPaused = false; synth.resume(); updatePlayerUI(); return; }
  let bIdx = books.findIndex(x => x.bookId === (currentPlayingBookId || activeBookId));
  if (bIdx < 0) bIdx = 0;
  playHighlight(bIdx, currentPlayingHlIdx || 0);
}

function pausePlay() { if (isPlaying && !isPaused) { isPaused = true; synth.pause(); updatePlayerUI(); } }
function stopPlay(statusHint) { isPlaying = false; isPaused = false; clearInterval(keepAliveTimer); if (synth) synth.cancel(); updateActiveCardVisual(); updatePlayerUI(statusHint); }
function playFromSpecific(bookId, hlIdx) { const bIdx = books.findIndex(x => x.bookId === bookId); if (bIdx >= 0) playHighlight(bIdx, hlIdx); }

playBtn.onclick = () => { if (!isPlaying || isPaused) startPlay(); else pausePlay(); };
stopBtn.onclick = () => stopPlay('已停止朗读');
nextBtn.onclick = () => { let bIdx = books.findIndex(x => x.bookId === (currentPlayingBookId || activeBookId)); if (bIdx >= 0) playHighlight(bIdx, (currentPlayingHlIdx || 0) + 1); };
prevBtn.onclick = () => { let bIdx = books.findIndex(x => x.bookId === (currentPlayingBookId || activeBookId)); if (bIdx >= 0) playHighlight(bIdx, Math.max(0, (currentPlayingHlIdx || 0) - 1)); };
rateSelect.onchange = () => { if (isPlaying && !isPaused) { let bIdx = books.findIndex(x => x.bookId === currentPlayingBookId); if (bIdx >= 0) playHighlight(bIdx, currentPlayingHlIdx); } };

// ---- 共享书库（data/books.json，由 GitHub Actions 自动更新）----
function setLibStatus(t) { if (libStatusEl) libStatusEl.textContent = t; }

// 书籍元信息字段（非划线）：只要共享数据里有值，就同步到本地。
// 注意：这些字段的同步**不能**和划线条数绑定，否则划线条数没变化的书永远拿不到简介。
const META_FIELDS = [
  'infoId', 'intro', 'rating', 'ratingCount', 'category',
  'publisher', 'publishTime', 'cover', 'deepLink', 'reviewCount', 'topReview'
];

function isBlank(v) {
  return v === undefined || v === null || v === '' ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
}

async function loadSharedLibrary() {
  try {
    const r = await fetch('data/books.json', { cache: 'no-store' });
    if (!r.ok) { setLibStatus('共享书库：读取失败（HTTP ' + r.status + '）'); return; }
    const d = await r.json();
    if (!d || !Array.isArray(d.books)) { setLibStatus('共享书库：数据格式异常'); return; }
    const dm = loadDeletedMap();
    let changed = 0, metaFixed = 0, totalHl = 0;
    d.books.forEach(b => {
      if (!b || !b.bookId || !Array.isArray(b.highlights)) return;
      totalHl += b.highlights.length;
      const parsed = parseBook({ book: b }, b.title || '共享书');
      parsed.shared = true;
      const idx = books.findIndex(x => x.bookId === b.bookId);
      if (idx < 0) {
        books.push(parsed);
        changed++;
        return;
      }
      const local = books[idx];
      let touched = false;
      // ① 划线：仅当共享数据更全（条数更多）时替换，避免把本地删选结果盖回去。
      //     这样本地数据一旦被更全的共享数据更新过，后续刷新就不会来回反复。
      if (parsed.highlights.length > (local.highlights || []).length) {
        // 覆盖前套用本地删除清单，避免已删的划线又被带回来
        const del = new Set(dm[b.bookId] || []);
        let hs = parsed.highlights;
        if (del.size) hs = hs.filter(h => !del.has(h.key));
        local.highlights = hs;
        local.count = hs.length;
        touched = true;
      }
      // ② 元信息（简介 / 评分 / 读后感 / 封面 / 跳转…）：与划线数量无关，缺就补、变就更新。
      //    否则「划线条数本来就没变」的书会一直显示「暂无简介数据」。
      META_FIELDS.forEach(k => {
        const v = parsed[k];
        if (isBlank(v)) return;
        if (isBlank(local[k]) || JSON.stringify(local[k]) !== JSON.stringify(v)) {
          local[k] = v;
          touched = true;
          if (k === 'intro' || k === 'topReview') metaFixed++;
        }
      });
      if (touched) changed++;
    });
    if (changed) {
      saveBooks();
      renderSidebar();
      // 当前正在看的这本书，立即把新补上的简介/读后感刷到界面上
      if (activeBookId) {
        const cur = books.find(x => x.bookId === activeBookId);
        if (cur) {
          renderBookInfo(cur);
          ensureBookExtra(cur);
        }
      }
    }
    // 把「实际读到的数据版本」显示出来，便于确认页面有没有吃到新数据
    setLibStatus('共享书库：' + d.books.length + ' 本 · ' + totalHl + ' 条' +
      (d.updatedAt ? ' · 更新于 ' + d.updatedAt : '') +
      (changed ? ' · 已刷新本地 ' + changed + ' 本' : '') +
      (metaFixed ? ' · 补齐简介/读后感 ' + metaFixed + ' 项' : ''));
  } catch (e) {
    setLibStatus('共享书库：未加载（离线模式或本地服务未启动）');
  }
}

// ---- 访客模式（GitHub Pages）：通过自有 Cloudflare Pages Functions 代理 + 公共 CORS 代理抓取微信读书接口 ----
let visitorMode = false;
// 自有代理（Cloudflare Pages Functions，仓库 functions/api/weread.js）。Pages 项目部署后域名形如 <项目名>.pages.dev：
const REMOTE_API = 'https://weread-highlights.pages.dev/api/weread';
// 公共代理仅作兜底（不稳定，可能失效）
const CORS_PROXIES = [
  u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
  u => 'https://corsproxy.io/?url=' + encodeURIComponent(u),
  u => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u)
];
async function proxyFetchText(url) {
  let lastErr;
  for (const wrap of CORS_PROXIES) {
    try {
      const r = await fetch(wrap(url), { cache: 'no-store' });
      if (r.ok) {
        const t = await r.text();
        if (t) return t;
      }
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('所有代理均失败');
}
function decodeJsonStr(s) { try { return JSON.parse('"' + s + '"'); } catch (e) { return s; } }

// 复刻 server.py fetch_via_anonymous：优先走自有 Vercel 代理，失败退回公共 CORS 代理
async function visitorFetchBook(infoId) {
  infoId = String(infoId).trim();
  // ① 自有代理：一步返回标准结构 {bookId,title,author,items,...}
  try {
    const r = await fetch(REMOTE_API + '?bookId=' + encodeURIComponent(infoId), { cache: 'no-store' });
    if (r.ok) {
      const d = await r.json();
      if (d.errcode != null && d.errcode !== 0) throw new Error(d.errmsg || ('微信读书返回 ' + d.errcode));
      if (d && d.items) return d;
    }
  } catch (e) { /* 自有代理不可用则继续走公共链 */ }

  // ② 公共代理兜底：详情页提 bookId/书名/作者 → bestbookmarks 匿名接口
  let bookId = /^\d+$/.test(infoId) ? infoId : null;
  let title = '', author = '';
  if (!bookId) {
    const html = await proxyFetchText('https://weread.qq.com/web/book/detail/' + infoId);
    const safe = infoId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let m = html.match(new RegExp('"reader"\\s*:\\s*\\{[^{}]*?"infoId"\\s*:\\s*"' + safe + '"[^{}]*?"bookId"\\s*:\\s*"(\\d+)"'));
    if (!m) {
      const all = html.match(/"bookId"\s*:\s*"(\d+)"/);
      if (all) m = all;
    }
    if (m) bookId = m[1];
    const tm = html.match(/"bookInfo"\s*:\s*\{[^{}]*?"title"\s*:\s*"(.*?)"/);
    const am = html.match(/"bookInfo"\s*:\s*\{[^{}]*?"author"\s*:\s*"(.*?)"/);
    if (tm) title = decodeJsonStr(tm[1]);
    if (am) author = decodeJsonStr(am[1]);
  }
  if (!bookId) throw new Error('无法从详情页解析 bookId');
  // 必须传 count，否则接口默认只返回 10 条（maxIdx 实测无效）
  const body = await proxyFetchText('https://weread.qq.com/web/book/bestbookmarks?bookId=' + bookId + '&hasLogin=0&count=' + FETCH_COUNT);
  const raw = JSON.parse(body);
  if (raw.errcode != null && raw.errcode !== 0) {
    const err = new Error(raw.errmsg || ('微信读书返回 ' + raw.errcode));
    err.wereadErrcode = raw.errcode;
    throw err;
  }
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
    users: it.users || []
  }));
  return {
    bookId, infoId, title, author,
    totalCount: bb.totalCount,
    count: items.length,
    items, chapters
  };
}

// ---- 检测是否本地工具模式（Pages 上无本地服务）----
async function detectLocalMode() {
  let local = false;
  try {
    const r = await fetch('/api/ping', { cache: 'no-store' });
    const d = await r.json();
    local = !!(d && d.ok);
  } catch (e) { local = false; }
  if (!local) {
    // GitHub Pages 访客模式：保留加书入口（走公共 CORS 代理），仅隐藏同步按钮
    visitorMode = true;
    document.querySelectorAll('#syncbar').forEach(el => { el.style.display = 'none'; });
    const hint = document.getElementById('pageModeHint');
    if (hint) {
      hint.style.display = 'block';
      hint.innerHTML = '🌐 这是公开共享书库，大家看到的是同一份书单。<br>' +
        '你加的书、删除的划线只保存在<b>你自己的浏览器</b>里，不影响其他人。<br>' +
        '点「导出全部 (JSON)」可备份你的书单，换设备后用「导入 JSON」恢复。';
    }
    const fh = document.querySelector('.fetchbar-hint');
    if (fh) {
      fh.innerHTML = '粘贴书籍详情页 URL 里 <code>bookDetail/</code> 后面那串（<code>b</code> 开头或纯数字均可）。' +
        '你加的书保存在<b>你自己的浏览器</b>，别人看不到；想分享给大家请找库主。';
    }
  }
  return local;
}

// ---- 同步共享书库：把删减后的数据 + 删除清单写到仓库文件 ----
const syncBtn = document.getElementById('syncBtn');
const syncStatus = document.getElementById('syncStatus');
syncBtn.onclick = async () => {
  const dm = loadDeletedMap();
  if (!books.length && !Object.keys(dm).length) {
    syncStatus.textContent = '没有需要同步的内容';
    return;
  }
  if (!confirm('将当前书库（含删除）同步到 data/books.json？\n推送后网页所有人可见。')) return;
  syncStatus.textContent = '同步中…';
  syncBtn.disabled = true;
  try {
    const payload = {
      deleted: dm,
      books: books.map(b => ({
        bookId: b.bookId,
        infoId: b.infoId || '',
        title: b.title || '',
        author: b.author || '',
        // 带上简介/读后感等扩展字段，避免从页面同步时把它们抹掉
        intro: b.intro || '',
        rating: b.rating != null ? b.rating : null,
        ratingCount: b.ratingCount || null,
        category: b.category || '',
        publisher: b.publisher || '',
        publishTime: b.publishTime || '',
        cover: b.cover || '',
        deepLink: b.deepLink || '',
        reviewCount: b.reviewCount || null,
        topReview: b.topReview || null,
        highlights: (b.highlights || []).map(h => ({
          text: h.text, count: h.count, chapter: h.chapter,
          chapterUid: h.chapterUid, key: h.key
        }))
      }))
    };
    const r = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const d = await r.json();
    if (d.ok) {
      syncStatus.textContent = '✅ 已同步 ' + d.books + ' 本书。去 GitHub Desktop 点「Push origin」即可让网页更新。';
    } else {
      syncStatus.textContent = '❌ ' + (d.error || '同步失败');
    }
  } catch (e) {
    syncStatus.textContent = '❌ 请求失败，请确认本地工具已启动 (start.bat)';
  } finally {
    syncBtn.disabled = false;
  }
};

// 启动
(async () => {
  renderSidebar();
  await loadSharedLibrary();
  await detectLocalMode();
  if (activeBookId) {
    selectBook(activeBookId);
  } else if (books.length) {
    selectBook(books[0].bookId);
  }
  updatePlayerUI();
  // 静默补全旧数据的书名/作者
  books.forEach(b => refreshBookMeta(b));
})();
