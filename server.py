#!/usr/bin/env python3
# 微信读书热门划线摘录 —— 本地代理服务
# 作用：用户在网页填 infoId/bookId，后端匿名请求微信读书公开接口获取热门划线数据，全程无需登录。
import http.server
import json
import os
import re
import socketserver
import sys
import time
import urllib.parse
import urllib.request
import html

PORT = 8000
ROOT = os.path.dirname(os.path.abspath(__file__))
BOOK_DETAIL_URL = 'https://weread.qq.com/web/bookDetail/'
BESTBOOK_URL = 'https://weread.qq.com/web/book/bestbookmarks'
LOG_FILE = os.path.join(ROOT, 'server.log')

# 微信读书 Skill 网关：获取书籍简介、评分、读后感（需要环境变量 WEREAD_API_KEY）。
# 注意：简介与点评都无法匿名获取（匿名会返回「用户不存在」），必须带 Key。
GATEWAY_URL = 'https://i.weread.qq.com/api/agent/gateway'
SKILL_VERSION = '1.0.4'
# 存入 books.json 的读后感正文上限，避免个别超长书评把数据文件撑大
REVIEW_MAX_CHARS = 2000
# 简介/点评的内存缓存（同一本书反复点开时不必重复请求网关）
EXTRA_CACHE = {}
EXTRA_TTL = 6 * 3600

# 每本书取热度前 N 条热门划线。接口不传 count 时默认只给 10 条，
# 必须显式传 count 才能超过 10；这里按需求取前 30 条（接口返回已按热度排序）。
FETCH_COUNT = 30

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'


def log(msg):
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write('[%s] %s\n' % (time.strftime('%H:%M:%S'), msg))
    except Exception:
        pass


def http_get(url, referer=None, timeout=20):
    headers = {
        'User-Agent': UA,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
    }
    if referer:
        headers['Referer'] = referer
    req = urllib.request.Request(url, headers=headers)
    return urllib.request.urlopen(req, timeout=timeout)


def decode_str(s):
    if not s:
        return ''
    # 仅针对形如 \u4e00 的 Unicode 转义进行替换，不破坏已有的 UTF-8 中文字符
    def unescape_u(match):
        try:
            return chr(int(match.group(1), 16))
        except Exception:
            return match.group(0)

    s = re.sub(r'\\u([0-9a-fA-F]{4})', unescape_u, s)
    return html.unescape(s).strip()


def gateway_call(api_name, **params):
    """调用微信读书 Skill 网关。需要环境变量 WEREAD_API_KEY（wrk- 开头）。

    摘要与点评类接口都要求登录态，匿名访问会返回 -2010「用户不存在」。
    """
    key = (os.environ.get('WEREAD_API_KEY') or '').strip()
    if not key:
        raise RuntimeError('未设置环境变量 WEREAD_API_KEY，无法获取简介/点评')
    payload = {'api_name': api_name}
    payload.update(params)
    payload['skill_version'] = SKILL_VERSION
    req = urllib.request.Request(
        GATEWAY_URL,
        data=json.dumps(payload).encode('utf-8'),
        method='POST',
        headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read().decode('utf-8'))
    if d.get('errcode') not in (None, 0):
        raise RuntimeError('网关返回 %s：%s' % (d.get('errcode'), d.get('errmsg')))
    return d


def fetch_book_extra(book_id):
    """获取书籍简介、评分与「最受推荐的读后感」。

    关于「获赞数第一」：网关不返回点赞数（点赞列表字段被裁剪），
    但 /review/list 的默认排序（reviewListType=0/1）就是 App 内的「热门/推荐」顺序，
    因此取其第一条，即全站最受认可的那篇读后感。
    """
    book_id = str(book_id).strip()
    info = gateway_call('/book/info', bookId=book_id)
    rating = info.get('newRating')
    extra = {
        'intro': (info.get('intro') or '').strip(),
        'rating': round(rating / 10.0, 1) if isinstance(rating, (int, float)) else None,
        'ratingCount': info.get('newRatingCount'),
        'category': info.get('category') or '',
        'publisher': info.get('publisher') or '',
        'publishTime': (info.get('publishTime') or '')[:10],
        'cover': info.get('cover') or '',
        'deepLink': info.get('deepLink') or '',
        'reviewCount': None,
        'topReview': None,
    }
    try:
        rl = gateway_call('/review/list', bookId=book_id, reviewListType=1, count=5)
        extra['reviewCount'] = rl.get('reviewsCnt')
        for item in (rl.get('reviews') or []):
            rv = ((item.get('review') or {}).get('review')) or {}
            content = (rv.get('content') or '').strip()
            if not content:
                continue
            author = rv.get('author') or {}
            extra['topReview'] = {
                'author': author.get('name') or '',
                'star': int(rv.get('star') or 0),
                'content': content[:REVIEW_MAX_CHARS],
                'truncated': len(content) > REVIEW_MAX_CHARS,
                'createTime': int(rv.get('createTime') or 0),
                'isFinish': int(rv.get('isFinish') or 0),
                'isDeepV': int(author.get('isDeepV') or 0),
                'chapterName': rv.get('chapterName') or '',
            }
            break
    except Exception as e:
        log('fetch_book_extra review error: %s' % e)
    return extra


def fetch_book_detail_info(info_id):
    """访问书籍详情页，单次请求提取真实 bookId、书名及作者。"""
    info_id = str(info_id).strip()
    # 如果本身已经是纯数字，说明已经是 bookId
    if info_id.isdigit():
        book_id = info_id
    else:
        book_id = None

    title = ''
    author = ''

    try:
        url = BOOK_DETAIL_URL + info_id
        r = http_get(url)
        html_content = r.read().decode('utf-8', 'ignore')

        if not book_id:
            # 优先从 reader 段匹配当前 infoId 对应的 bookId
            m = re.search(
                r'"reader"\s*:\s*\{[^{}]*?"infoId"\s*:\s*"' + re.escape(info_id) +
                r'"[^{}]*?"bookId"\s*:\s*"(\d+)"',
                html_content)
            if m:
                book_id = m.group(1)
            else:
                # 尝试通用正则匹配
                nums = re.findall(r'"bookId"\s*:\s*"(\d+)"', html_content)
                if nums:
                    book_id = nums[0]

        title_m = re.search(r'"bookInfo"\s*:\s*\{[^{}]*?"title"\s*:\s*"(.*?)"', html_content)
        author_m = re.search(r'"bookInfo"\s*:\s*\{[^{}]*?"author"\s*:\s*"(.*?)"', html_content)
        if title_m:
            title = decode_str(title_m.group(1))
        if author_m:
            author = decode_str(author_m.group(1))
    except Exception as e:
        log('fetch_book_detail_info error: %s' % e)

    if not book_id:
        raise RuntimeError('无法从详情页提取 bookId')

    return book_id, title, author


def fetch_bestbookmarks(book_id, info_id, count):
    """按指定条数拉一次热门划线原始回包。"""
    url = (BESTBOOK_URL + '?bookId=' + book_id + '&hasLogin=0'
           + '&count=' + str(int(count)))
    r = http_get(url, referer=BOOK_DETAIL_URL + info_id)
    body = r.read().decode('utf-8', 'ignore')
    return json.loads(body).get('bestBookMarks', {})


def fetch_via_anonymous(info_id):
    """匿名从 weread.qq.com web 接口拉热门划线（前 FETCH_COUNT 条，按热度排序）。
    返回标准化结构：{bookId, items:[...], totalCount:, ...}

    注意：该接口不传 count 时默认只返回 10 条，这是之前「只能摘前 10 条」的原因；
    且 maxIdx 实测无效（无论传多少都返回从第一条开始的前 N 条），
    所以要拿更多只能靠加大 count（上限实测可到近千条，如三体全集 974 条）。
    """
    book_id, title, author = fetch_book_detail_info(info_id)
    bb = fetch_bestbookmarks(book_id, info_id, FETCH_COUNT)
    items = bb.get('items') or []
    chapters = bb.get('chapters') or []
    chap_map = {c.get('chapterUid'): c.get('title', '') for c in chapters}

    norm_items = []
    for it in items:
        norm_items.append({
            'bookId': it.get('bookId'),
            'markText': it.get('markText', ''),
            'totalCount': it.get('totalCount', 0),
            'chapterUid': it.get('chapterUid'),
            'chapterTitle': chap_map.get(it.get('chapterUid'), ''),
            'bookmarkId': it.get('bookmarkId'),
            'users': it.get('users') or [],
        })

    return {
        'bookId': book_id,
        'infoId': info_id,
        'title': title,
        'author': author,
        'totalCount': bb.get('totalCount'),
        'count': len(norm_items),
        'items': norm_items,
        'chapters': chapters,
    }


class Handler(http.server.SimpleHTTPRequestHandler):
    def _send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path == '/api/sync':
            # 从本地工具同步「删减后的书库 + 删除清单」到仓库数据文件
            try:
                length = int(self.headers.get('Content-Length', 0))
                raw = self.rfile.read(length) if length else b'{}'
                data = json.loads(raw or b'{}')
                books = data.get('books') or []
                deleted = data.get('deleted') or {}

                # 1) 写 books.json（已是删减后的版本）
                # 页面传来的书若缺少某些字段（简介/读后感/totalCount 等），
                # 从现有 books.json 按 bookId 补齐，避免同步动作把已有数据抹掉。
                old_books = {}
                books_file = os.path.join(ROOT, 'data', 'books.json')
                if os.path.exists(books_file):
                    try:
                        with open(books_file, encoding='utf-8') as f:
                            for ob in (json.load(f).get('books') or []):
                                if ob.get('bookId'):
                                    old_books[str(ob['bookId'])] = ob
                    except Exception:
                        old_books = {}
                for b in books:
                    ob = old_books.get(str(b.get('bookId') or ''))
                    if not ob:
                        continue
                    for k, v in ob.items():
                        if k == 'highlights':
                            continue
                        if b.get(k) in (None, '', [], {}):
                            b[k] = v

                payload = {
                    'version': 1,
                    'updatedAt': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime()),
                    'count': len(books),
                    'books': books,
                }
                data_dir = os.path.join(ROOT, 'data')
                os.makedirs(data_dir, exist_ok=True)
                with open(os.path.join(data_dir, 'books.json'), 'w', encoding='utf-8') as f:
                    json.dump(payload, f, ensure_ascii=False, indent=2)

                # 2) 合并删除清单（防止 Actions 重跑把删除加回来）
                del_file = os.path.join(data_dir, 'deleted.json')
                old = {}
                if os.path.exists(del_file):
                    try:
                        with open(del_file, encoding='utf-8') as f:
                            old = json.load(f)
                    except Exception:
                        old = {}
                for bid, keys in (deleted or {}).items():
                    old.setdefault(bid, [])
                    for k in keys:
                        if k not in old[bid]:
                            old[bid].append(k)
                with open(del_file, 'w', encoding='utf-8') as f:
                    json.dump(old, f, ensure_ascii=False, indent=2)

                self._send_json({'ok': True, 'books': len(books),
                                 'deletedKeys': sum(len(v) for v in old.values())})
            except Exception as e:
                self._send_json({'ok': False, 'error': str(e)}, 500)
            return
        self._send_json({'ok': False, 'error': 'not found'}, 404)

    def do_GET(self):
        if self.path == '/api/ping':
            # 前端用它判断「本地工具模式」是否可用（GitHub Pages 上没有本服务）
            self._send_json({'ok': True, 'mode': 'local'})
            return

        if self.path.startswith('/api/bookmeta'):
            qs = urllib.parse.urlparse(self.path).query
            params = urllib.parse.parse_qs(qs)
            info_id = (params.get('infoId') or [''])[0].strip()
            if not info_id:
                self._send_json({'errcode': -1, 'errmsg': 'infoId 必填'}, 400)
                return
            try:
                _, title, author = fetch_book_detail_info(info_id)
                self._send_json({'ok': True, 'title': title, 'author': author})
            except Exception as e:
                self._send_json({'ok': False, 'errmsg': str(e)[:200]}, 500)
            return

        if self.path.startswith('/api/bookextra'):
            params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            book_id = (params.get('bookId') or [''])[0].strip()
            if not book_id:
                self._send_json({'ok': False, 'errmsg': 'bookId 必填'}, 400)
                return
            now = time.time()
            hit = EXTRA_CACHE.get(book_id)
            if hit and now - hit[0] < EXTRA_TTL:
                body = {'ok': True, 'cached': True}
                body.update(hit[1])
                self._send_json(body)
                return
            try:
                extra = fetch_book_extra(book_id)
                EXTRA_CACHE[book_id] = (now, extra)
                log('bookextra %s -> intro=%d字 review=%s' % (
                    book_id, len(extra.get('intro') or ''),
                    '有' if extra.get('topReview') else '无'))
                body = {'ok': True}
                body.update(extra)
                self._send_json(body)
            except Exception as e:
                msg = str(e)[:300]
                # 用 200 返回，前端好展示「需配置 Key」这类提示，而不是报网络错误
                self._send_json({'ok': False, 'errmsg': msg,
                                 'needKey': 'WEREAD_API_KEY' in msg})
            return

        if self.path.startswith('/api/bestbookmarks'):
            qs = urllib.parse.urlparse(self.path).query
            params = urllib.parse.parse_qs(qs)
            info_id = (params.get('bookId') or params.get('infoId') or [''])[0].strip()
            if not info_id:
                self._send_json({'errcode': -1, 'errmsg': 'bookId/infoId 必填'}, 400)
                return
            log('bestbookmarks infoId=%s' % info_id)
            try:
                data = fetch_via_anonymous(info_id)
                log('  -> items=%d totalCount=%s' % (data['count'], data['totalCount']))
                body = json.dumps(data, ensure_ascii=False).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(body)
                return
            except urllib.error.HTTPError as e:
                self._send_json({'errcode': e.code,
                                 'errmsg': e.read().decode('utf-8', 'ignore')[:300]}, 502)
                return
            except Exception as e:
                self._send_json({'errcode': -1, 'errmsg': str(e)[:300]}, 500)
                return

        return super().do_GET()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    os.chdir(ROOT)
    try:
        logf = open(os.path.join(ROOT, 'server.log'), 'a', encoding='utf-8', buffering=1)
        sys.stdout = logf
        sys.stderr = logf
    except Exception:
        pass
    with socketserver.TCPServer(('127.0.0.1', PORT), Handler) as httpd:
        print(f'微信读书热门划线摘录 服务已启动: http://127.0.0.1:{PORT}')
        print('直接在页面填 bookId 或 infoId（如 b35326a0813abab07g0115b3），无需登录。')
        httpd.serve_forever()