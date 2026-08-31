#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
批量抓取 watchlist 里的书，生成 data/books.json（共享书库）。

用途：
- 本地：python scripts/fetch_books.py
- CI（GitHub Actions）：每天定时运行，自动提交更新

watchlist 格式（data/watchlist.txt）：
- 每行一个 bookId / infoId（b 开头或纯数字均可）
- # 开头为注释，空行忽略
"""
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from server import fetch_via_anonymous  # noqa: E402

WATCHLIST = os.path.join(ROOT, 'data', 'watchlist.txt')
OUTPUT = os.path.join(ROOT, 'data', 'books.json')
DELETED_FILE = os.path.join(ROOT, 'data', 'deleted.json')


def read_watchlist():
    if not os.path.exists(WATCHLIST):
        return []
    ids = []
    with open(WATCHLIST, 'r', encoding='utf-8') as f:
        for line in f:
            s = line.strip()
            if not s or s.startswith('#'):
                continue
            ids.append(s)
    seen = set()
    return [i for i in ids if not (i in seen or seen.add(i))]


def read_deleted():
    """读取删除清单：{bookId: [key, ...]}，用于过滤已删划线。"""
    if not os.path.exists(DELETED_FILE):
        return {}
    try:
        with open(DELETED_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def main():
    ids = read_watchlist()
    deleted = read_deleted()
    print('watchlist 共 %d 个 bookId' % len(ids))
    books = []
    for info_id in ids:
        try:
            d = fetch_via_anonymous(info_id)
            bid = d['bookId']
            removed = set(deleted.get(bid, []))
            highlights = [
                {
                    'text': h['markText'],
                    'count': h['totalCount'],
                    'chapter': h['chapterTitle'],
                    'chapterUid': h['chapterUid'],
                    'key': h['bookmarkId'] or ('idx-%d' % i),
                }
                for i, h in enumerate(d['items'])
                if (h['bookmarkId'] or ('idx-%d' % i)) not in removed
            ]
            books.append({
                'bookId': bid,
                'infoId': d['infoId'],
                'title': d['title'],
                'author': d['author'],
                'totalCount': d['totalCount'],
                'highlights': highlights,
            })
            print('  ✅ %s -> %d 条（%s，过滤删除 %d 条）' % (
                info_id, len(highlights), d['title'], len(d['items']) - len(highlights)))
        except Exception as e:
            print('  ❌ %s 失败: %s' % (info_id, e))
        time.sleep(1)  # 温和请求，避免过快

    payload = {
        'version': 1,
        'updatedAt': time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime()),
        'count': len(books),
        'books': books,
    }
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print('已写入 %s（%d 本书）' % (OUTPUT, len(books)))


if __name__ == '__main__':
    main()
