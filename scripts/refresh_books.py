# -*- coding: utf-8 -*-
"""原地刷新 data/books.json。

做两件事：
1) 重新抓每本书的热门划线（前 FETCH_COUNT 条，匿名接口，无需登录）；
2) 顺带抓「简介 / 评分 / 最受推荐的读后感」（Skill 网关，需要环境变量 WEREAD_API_KEY；
   未设置时自动跳过第 2 步，只刷新划线）。

为什么不用 scripts/fetch_books.py：watchlist.txt 只有 20 条，而 books.json 里有 25 本，
直接重跑会静默丢掉那 5 本手工加的书。
"""
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from server import fetch_via_anonymous, fetch_book_extra  # noqa: E402

BOOKS = os.path.join(ROOT, 'data', 'books.json')
DELETED = os.path.join(ROOT, 'data', 'deleted.json')


def main():
    data = json.load(open(BOOKS, encoding='utf-8'))
    books = data.get('books', [])
    deleted = {}
    if os.path.exists(DELETED):
        try:
            deleted = json.load(open(DELETED, encoding='utf-8'))
        except Exception:
            deleted = {}

    has_key = bool((os.environ.get('WEREAD_API_KEY') or '').strip())
    print('待刷新 %d 本' % len(books))
    if has_key:
        print('已检测到 WEREAD_API_KEY：同时刷新简介 / 评分 / 读后感')
    else:
        print('⚠️ 未设置 WEREAD_API_KEY：只刷新热门划线，跳过简介 / 读后感')
        print('   如需一起刷新，先在 PowerShell 执行：setx WEREAD_API_KEY "wrk-..." 并重开终端')

    updated, failed = [], []
    extra_ok = extra_fail = 0
    for i, b in enumerate(books, 1):
        old_n = len(b.get('highlights', []))
        # 优先用 infoId 解析（能顺带补书名/作者）；解析失败时退回纯数字 bookId 直取
        keys = [k for k in (b.get('infoId'), b.get('bookId')) if k]
        d = None
        err = None
        for k in keys:
            try:
                d = fetch_via_anonymous(k)
                break
            except Exception as e:
                err = e
        try:
            if d is None:
                raise err or RuntimeError('无可用 bookId/infoId')
            bid = d['bookId'] or b.get('bookId')
            removed = set(deleted.get(bid, []))
            highlights = [
                {
                    'text': h['markText'],
                    'count': h['totalCount'],
                    'chapter': h['chapterTitle'],
                    'chapterUid': h['chapterUid'],
                    'key': h['bookmarkId'] or ('idx-%d' % j),
                }
                for j, h in enumerate(d['items'])
                if (h['bookmarkId'] or ('idx-%d' % j)) not in removed
            ]
            b['bookId'] = bid
            b['title'] = d['title'] or b.get('title') or ''
            b['author'] = d['author'] or b.get('author') or ''
            b['totalCount'] = d['totalCount']
            b['highlights'] = highlights
            note = ('（本次过滤已删 %d 条）' % len(removed)) if removed else ''

            # ---- 简介 / 评分 / 读后感 ----
            if has_key and bid:
                try:
                    extra = fetch_book_extra(bid)
                    # 只覆盖有值的字段：某次抓取失败不会把已有数据抹掉
                    for k, v in extra.items():
                        if v not in (None, '', [], {}):
                            b[k] = v
                    extra_ok += 1
                    if extra.get('topReview'):
                        note += ' +读后感'
                except Exception as e:
                    extra_fail += 1
                    note += ' [简介/点评失败: %s]' % str(e)[:60]
                time.sleep(0.4)

            print('[%2d/%d] %-28s %3d -> %3d 条%s' % (
                i, len(books), (b['title'] or '')[:28], old_n, len(highlights), note))
            updated.append(b)
        except Exception as e:
            failed.append((b.get('title'), str(e)))
            print('[%2d/%d] %-28s 失败: %s' % (i, len(books), (b.get('title') or '')[:28], e))
            updated.append(b)
        time.sleep(0.6)  # 温和请求

    payload = {
        'version': data.get('version', 1),
        'updatedAt': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime()),
        'count': len(updated),
        'books': updated,
    }
    json.dump(payload, open(BOOKS, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    total = sum(len(b.get('highlights', [])) for b in updated)
    with_intro = sum(1 for b in updated if b.get('intro'))
    with_review = sum(1 for b in updated if b.get('topReview'))
    print('\n已写入 %s' % BOOKS)
    print('共 %d 本，划线合计 %d 条；划线失败 %d 本' % (len(updated), total, len(failed)))
    if has_key:
        print('简介 %d 本，读后感 %d 本（简介/点评失败 %d 次）' % (with_intro, with_review, extra_fail))
    for t, e in failed:
        print('  ❌', t, e)


if __name__ == '__main__':
    main()
