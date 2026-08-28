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


def fetch_via_anonymous(info_id):
    """匿名从 weread.qq.com web 接口拉热门划线。
    返回标准化结构：{bookId, items:[...], totalCount:, ...}
    """
    book_id, title, author = fetch_book_detail_info(info_id)
    url = BESTBOOK_URL + '?bookId=' + book_id + '&hasLogin=0'
    r = http_get(url, referer=BOOK_DETAIL_URL + info_id)
    body = r.read().decode('utf-8', 'ignore')
    raw = json.loads(body)
    bb = raw.get('bestBookMarks', {})
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

    def do_GET(self):
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