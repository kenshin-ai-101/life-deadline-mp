#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""小程序静态校验：配置 / 文件齐全 / 引用路径 / 包体 / WXML 表达式。"""
import json
import os
import re
import subprocess
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ERRORS = []
WARNS = []


def err(msg): ERRORS.append(msg)
def warn(msg): WARNS.append(msg)


def rel(p): return os.path.relpath(p, BASE)


cfg = json.load(open(os.path.join(BASE, 'app.json'), encoding='utf-8'))
proj = json.load(open(os.path.join(BASE, 'project.config.json'), encoding='utf-8'))

# 1. 顶层约束
if cfg.get('lazyCodeLoading') != 'requiredComponents':
    err('app.json 缺少 lazyCodeLoading: requiredComponents')
if not cfg.get('pages'):
    err('app.json.pages 为空')
if proj.get('miniprogramRoot') not in ('.', './'):
    err('project.config.json 的 miniprogramRoot 未指向含 app.json 的源码根')

# 2. 页面清单
pages = list(cfg['pages'])
sub_roots = []
for sp in cfg.get('subpackages', cfg.get('subPackages', [])):
    root = sp['root']
    sub_roots.append(root)
    for p in sp['pages']:
        pages.append(root + '/' + p)

for p in pages:
    for ext in ('.js', '.wxml', '.json'):
        f = os.path.join(BASE, p + ext)
        if not os.path.exists(f):
            err('缺少 %s' % rel(f))
    # .wxss 可选，但模板约定保留
    if not os.path.exists(os.path.join(BASE, p + '.wxss')):
        warn('缺少 %s.wxss（可选）' % p)

# 3. tabBar
tab = cfg.get('tabBar', {})
for item in tab.get('list', []):
    if item['pagePath'] not in cfg['pages']:
        err('tabBar 页面必须在主包 pages 中声明：' + item['pagePath'])
    for k in ('iconPath', 'selectedIconPath'):
        if k in item and not os.path.exists(os.path.join(BASE, item[k])):
            err('tabBar 图标不存在：' + item[k])

# 4. 严格 JSON
for root, dirs, files in os.walk(BASE):
    if '.workbuddy' in root or os.sep + 'tools' in root:
        continue
    for f in files:
        if f.endswith('.json'):
            path = os.path.join(root, f)
            try:
                json.load(open(path, encoding='utf-8'))
            except Exception as e:
                err('JSON 非法 %s: %s' % (rel(path), e))

# 5. require 相对路径
for p in pages:
    js = os.path.join(BASE, p + '.js')
    if not os.path.exists(js):
        continue
    src = open(js, encoding='utf-8').read()
    for m in re.finditer(r"require\(['\"](\.[^'\"]+)['\"]\)", src):
        target = m.group(1)
        if not target.endswith('.js'):
            target += '.js'
        full = os.path.normpath(os.path.join(os.path.dirname(js), target))
        if not os.path.exists(full):
            err('%s 引用了不存在的文件 %s' % (rel(js), target))

# 6. 跳转路径必须指向已注册页面
url_re = re.compile(r"(?:navigateTo|redirectTo|switchTab|reLaunch)\(\{\s*url:\s*['\"]([^'\"?]+)")
page_set = set('/' + p for p in pages)
for p in pages:
    js = os.path.join(BASE, p + '.js')
    if not os.path.exists(js):
        continue
    src = open(js, encoding='utf-8').read()
    for m in url_re.finditer(src):
        url = m.group(1).split('?')[0].rstrip('/')
        if url not in page_set:
            err('%s 跳转到未注册页面 %s' % (rel(js), url))
        if 'switchTab' in m.group(0) and url.lstrip('/') not in [x['pagePath'] for x in tab.get('list', [])]:
            err('%s 用 switchTab 跳到非 tabBar 页面 %s' % (rel(js), url))

# 7. WXML 表达式禁用语法
bad_patterns = [
    (r'\{\{[^}]*\?\.', '可选链 ?.'),
    (r'\{\{[^}]*\?\?', '空值合并 ??'),
    (r'\{\{[^}]*=>', '箭头函数'),
    (r'\{\{[^}]*\b(?:window|document|localStorage)\b', '浏览器 API'),
    (r'\{\{[^}]*(?<![=!<>])=(?!=)[^}]*\}\}', '疑似赋值表达式'),
]
html_tags = ['div', 'span', 'p', 'h1', 'h2', 'ul', 'li', 'a', 'img', 'table', 'tr', 'td', 'section', 'article']
for p in pages:
    wxml = os.path.join(BASE, p + '.wxml')
    if not os.path.exists(wxml):
        continue
    src = open(wxml, encoding='utf-8').read()
    for pat, name in bad_patterns:
        if re.search(pat, src):
            err('%s 含 WXML 不支持的语法：%s' % (rel(wxml), name))
    for tag in html_tags:
        if re.search(r'<%s[\s>]' % tag, src):
            err('%s 使用了 HTML 标签 <%s>' % (rel(wxml), tag))
    # require 之外的 style 引用检查
    if 'background-image' in src:
        warn('%s 含 background-image（小程序本地图片请用 image 组件）' % rel(wxml))

# 8. JS 语法（node --check）
js_files = [os.path.join(BASE, p + '.js') for p in pages]
js_files += [os.path.join(BASE, f) for f in ('app.js', 'utils/store.js', 'utils/date.js',
                                            'utils/format.js', 'utils/library.js',
                                            'data/rules.js', 'data/items.js',
                                            'data/catalog.js', 'data/meta.js',
                                            'data/books.js', 'data/social-catalog.js',
                                            'data/social-items.js', 'data/social-details.js',
                                            'pkg-read/data/details.js', 'pkg-aid/data/aid.js')]
for f in js_files:
    if not os.path.exists(f):
        continue
    r = subprocess.run(['node', '--check', f], capture_output=True, text=True)
    if r.returncode != 0:
        err('JS 语法错误 %s: %s' % (rel(f), r.stderr.strip().split('\n')[-2:]))

# 9. 包体
def tree_size(paths):
    total = 0
    for path in paths:
        for root, dirs, files in os.walk(path):
            for f in files:
                total += os.path.getsize(os.path.join(root, f))
    return total

main_paths = [os.path.join(BASE, d) for d in ('pages', 'data', 'utils', 'images')]
main_paths += [os.path.join(BASE, f) for f in ('app.js', 'app.json', 'app.wxss',
                                               'project.config.json', 'sitemap.json')]
main_size = sum(os.path.getsize(f) for f in main_paths if os.path.isfile(f))
main_size += tree_size([os.path.join(BASE, d) for d in ('pages', 'data', 'utils', 'images')])
print('包体：主包 %.2f MB' % (main_size / 1024 / 1024))
if main_size > 1.5 * 1024 * 1024:
    err('主包超过 1.5 MB')
for root in sub_roots:
    size = tree_size([os.path.join(BASE, root)])
    print('      %-12s %.2f MB' % (root, size / 1024 / 1024))
    if size > 2 * 1024 * 1024:
        err('%s 分包超过 2 MB' % root)

print('\n页面 %d 个（主包 %d / 分包 %d）' % (len(pages), len(cfg['pages']), len(pages) - len(cfg['pages'])))
for w in WARNS:
    print('[WARN] ' + w)
if ERRORS:
    print('\n发现 %d 个错误：' % len(ERRORS))
    for e in ERRORS:
        print('  ✗ ' + e)
    sys.exit(1)
print('\n静态校验全部通过')
