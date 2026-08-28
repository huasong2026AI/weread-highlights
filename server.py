#!/usr/bin/env python3
# 微信读书热门划线摘录 —— 本地代理服务（v4 重 匿名架构）
# 作用：用户在网页填 infoId（bookDetail URL 后缀），后端匿名请求微信读书
#      公开接口获取热门划线数据，全程无需登录。
import http.server
import socketserver
import json
import os
import re
import socket
import time
import urllib.parse
import urllib.request

PORT = 8000
ROOT = os.path.dirname(os.path.abspath(__file__))
BOOK_DETAIL_URL = 'https://weread.qq.com/web/bookDetail/'
BESTBOOK_URL = 'https://weread.qq.com/web/book/bestbookmarks'
LOG_FILE = os.path.join(ROOT, 'server.log')
LOGIN_PORT = 8765  # 旧版驻留监听端口（保留兼容，新流程不再使用）

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


def info_id_to_book_id(info_id):
    """访问书籍详情页，从 INITIAL_STATE 提取真实 bookId。"""
    url = BOOK_DETAIL_URL + info_id
    r = http_get(url)
    html = r.read().decode('utf-8', 'ignore')
    # reader 段：infoId 紧跟着 bookId
    m = re.search(
        r'"reader"\s*:\s*\{[^{}]*?"infoId"\s*:\s*"' + re.escape(info_id) +
        r'"[^{}]*?"bookId"\s*:\s*"(\d+)"',
        html)
    if m:
        return m.group(1)
    # fallback：找 INITIAL_STATE 里第一个独立数字 bookId
    nums = re.findall(r'"bookId"\s*:\s*"(\d+)"', html)
    if nums:
        return nums[0]
    raise RuntimeError('无法从详情页提取 bookId')


def fetch_book_meta(info_id):
    """访问详情页提取书名、作者。返回 (title, author) 或 ('', '')。"""
    try:
        url = BOOK_DETAIL_URL + info_id
        html = http_get(url).read().decode('utf-8', 'ignore')
        title_m = re.search(r'"bookInfo"\s*:\s*\{[^{}]*?"title"\s*:\s*"(.*?)"', html)
        author_m = re.search(r'"bookInfo"\s*:\s*\{[^{}]*?"author"\s*:\s*"(.*?)"', html)
        title = title_m.group(1) if title_m else ''
        author = author_m.group(1) if author_m else ''
        # 书名里可能有 \u 转义，简单还原常见转义
        return title, author
    except Exception:
        return '', ''


def fetch_via_anonymous(info_id):
    """匿名从 weread.qq.com web 接口拉热门划线。
    返回标准化结构：{bookId, items:[...], totalCount:,}
    """
    book_id = info_id_to_book_id(info_id)
    url = BESTBOOK_URL + '?bookId=' + book_id + '&hasLogin=0'
    r = http_get(url, referer=BOOK_DETAIL_URL + info_id)
    body = r.read().decode('utf-8', 'ignore')
    raw = json.loads(body)
    bb = raw.get('bestBookMarks', {})
    items = bb.get('items') or []
    chapters = bb.get('chapters') or []
    chap_map = {c.get('chapterUid'): c.get('title', '') for c in chapters}
    # 标准化为前端期望的 items 结构
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
    title, author = fetch_book_meta(info_id)
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


def fetch_via_login_browser(book_id):
    """旧版：让 login.py 驻留浏览器代为请求。保留以兼容可能仍驻留的旧会话。"""
    try:
        s = socket.create_connection(('127.0.0.1', LOGIN_PORT), timeout=3)
        s.sendall(b'bookId=' + book_id.encode('utf-8'))
        s.shutdown(socket.SHUT_WR)
        s.settimeout(45)
        data = b''
        while True:
            chunk = s.recv(65536)
            if not chunk:
                break
            data += chunk
        s.close()
        if data:
            return data.decode('utf-8')
    except Exception:
        pass
    return None


class Handler(http.server.SimpleHTTPRequestHandler):
    def _send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path == '/api/cookie':
            # 兼容旧版手动 cookie 同步
            try:
                length = int(self.headers.get('Content-Length', 0))
                raw = self.rfile.read(length) if length else b'{}'
                data = json.loads(raw or b'{}')
                cookie = data.get('cookie', '')
                with open(os.path.join(ROOT, 'cookie.txt'), 'w', encoding='utf-8') as f:
                    f.write(cookie)
                self._send_json({'ok': True, 'len': len(cookie)})
            except Exception as e:
                self._send_json({'ok': False, 'error': str(e)}, 500)
            return
        self._send_json({'ok': False, 'error': 'not found'}, 404)

    def do_GET(self):
        # 兼容旧端点：登录/状态
        if self.path.startswith('/api/login/'):
            self._send_json({'status': 'idle', 'msg': '新版本无需登录，直接输入 infoId 获取即可'})
            return

        if self.path.startswith('/api/bookmeta'):
            qs = urllib.parse.urlparse(self.path).query
            params = urllib.parse.parse_qs(qs)
            info_id = (params.get('infoId') or [''])[0].strip()
            if not info_id:
                self._send_json({'errcode': -1, 'errmsg': 'infoId 必填'}, 400)
                return
            try:
                title, author = fetch_book_meta(info_id)
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
    # pythonw 无窗口运行时没有控制台，直接 print/写 stderr 会阻塞请求。
    # 统一把输出重定向到 server.log，保证任何环境下都不卡。
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