#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把上游《高性价比人生指南》的 book/*.md 编译成小程序可 require 的数据模块。

用法（在工程根目录执行）：
    python3 tools/sync_content.py [上游 book 目录]

产物：
    data/catalog.js          34 节目录
    data/items.js            全量精简索引（主包：搜索 / 筛选 / 列表 / 每日一条）
    data/meta.js             数据版本（上游 commit / 条数 / 生成时间）
    pkg-read/data/details.js 按条目 id 索引的长文本（分包：成本 / 收益 / 备注 / 来源）
    pkg-aid/data/aid.js      13 张处境急救卡，文字逐字取自第 13 节原文

设计要点：
- 主包只放检索所需字段，长文本放分包，控制主包体积。
- 急救卡不改写任何一个字，只按原句切分成行，并保留节-条出处。
- 证据类型是机器抽取结果，标记 needsReview，上线前需人工抽检。
"""

import glob
import json
import os
import re
import subprocess
import sys
from datetime import datetime

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_BOOK = os.path.normpath(os.path.join(BASE, '..', 'upstream', 'book'))
BOOK = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_BOOK

FIELD_RE = re.compile(r'^- (成本|说人话|收益|证据等级|来源|备注)：(.*)$', re.M)
TAG_RE = re.compile(r'<!--\s*成本标签:\s*(.*?)-->', re.S)
KV_RE = re.compile(r'([^\s=]+)=([^\s=]+)')
HEAD_RE = re.compile(r'^#\s*(\d+)\.\s*(.*)$', re.M)
ITEM_RE = re.compile(r'^(\d+)\.\s*(.*)')
LINK_RE = re.compile(r'https?://[^\s<>\u3000]+')

GRADE_ORDER = {'A': 0, 'B': 1, 'C': 2}


def cut(text, limit, marker='…'):
    """按完整句截断，避免断在半句。精简索引与分包详情共用。"""
    text = (text or '').strip()
    if len(text) <= limit:
        return text, False
    head = text[:limit]
    pos = max(head.rfind('。'), head.rfind('；'), head.rfind('，'))
    if pos > limit * 0.6:
        head = head[:pos + 1]
    return head + marker, True


def evidence_type(fields):
    gain = fields.get('收益', '')
    source = fields.get('来源', '')
    if '随机分成两组' in gain or '随机分组' in gain and '试验' in gain:
        return '随机对照试验'
    if re.search(r'队列|只记录|不分组|观察性|跟踪一大批', gain):
        return '观察性研究'
    if re.search(r'(法|条例|规定|办法)\s*第|第.{1,4}条', source):
        return '法条'
    if re.search(r'(部|委|局|统计局|卫健委|人社部|国务院|国家标准|公告|通知)', source):
        return '官方文件'
    if re.search(r'(报道|新闻|媒体)', source):
        return '仅媒体报道'
    return '经验共识'


def parse_file(path):
    sec = int(os.path.basename(path)[:2])
    text = open(path, encoding='utf-8').read()
    head = HEAD_RE.search(text)
    title = head.group(2).strip() if head else os.path.basename(path)[3:-3]
    intro = ''
    m = re.search(r'^#\s*\d+\..*?\n\n(.*?)\n\n', text, re.M | re.S)
    if m:
        intro = m.group(1).strip()

    items = []
    for block in re.split(r'\n### ', text)[1:]:
        m = ITEM_RE.match(block)
        if not m:
            continue
        num = int(m.group(1))
        name = m.group(2).strip()
        fields = dict(FIELD_RE.findall(block))
        tag_text = TAG_RE.search(block)
        tags = dict(KV_RE.findall(tag_text.group(1))) if tag_text else {}
        remark = fields.get('备注', '')
        plain = fields.get('说人话', '')
        source = fields.get('来源', '')
        item_id = '%02d-%d' % (sec, num)
        links = LINK_RE.findall(source)
        plain_short, _ = cut(plain, 150)
        gain_short, gain_trimmed = cut(fields.get('收益', ''), 500)
        source_short, source_trimmed = cut(source, 450)

        items.append({
            'id': item_id,
            's': sec,
            'n': num,
            't': name,
            'p': plain_short,
            'cost': {
                'money': tags.get('钱', ''),
                'time': tags.get('时间', ''),
                'will': tags.get('毅力', ''),
                'gain': tags.get('收益', ''),
                'lens': tags.get('口径', ''),
                'who': tags.get('人群', ''),
            },
            'grade': fields.get('证据等级', ''),
            'disputed': '争议' in remark,
            'ev': evidence_type(fields),
            'hasRef': bool(re.search(r'见第\s*\d+\s*节第\s*\d+\s*条', block)),
        })
        # 分包只存长文本；说人话正文已收在主包索引的 p 字段，不重复存
        items[-1]['_plain'] = plain
        items[-1]['_detail'] = {
            'costText': fields.get('成本', ''),
            'gainText': gain_short,
            'gainTrimmed': gain_trimmed,
            'remark': remark,
            'source': source_short,
            'sourceTrimmed': source_trimmed,
            'links': links,
            'evType': items[-1]['ev'],
        }
    return {'sec': sec, 'title': title, 'intro': intro, 'count': len(items)}, items


def build_aid(sections, all_items):
    """13 张急救卡：文字逐字引用第 13 节，不改写、不润色。"""
    by_id = {i['id']: i for i in all_items}
    detail_by_id = {i['id']: i.pop('_detail') for i in all_items}
    full_plain = {i['id']: i.pop('_plain') for i in all_items}

    # 处境 -> 第 13 节条目号。非急救类处境引用书里对应建议，均标注出处。
    cards = [
        ('collapse', '有人倒地', ['13-1', '13-16'], ['120']),
        ('bleed', '大出血', ['13-12'], ['120']),
        ('burn', '烧烫伤', ['13-14'], ['120']),
        ('choke', '噎住', ['13-26'], ['120']),
        ('co', '一氧化碳中毒', ['13-19'], ['120']),
        ('fire', '火灾', ['13-24'], ['119', '120']),
        ('drown', '溺水', ['13-25'], ['110', '120']),
        ('poison', '误服或化学品', ['13-20', '13-21'], ['120']),
        ('stroke', '疑似卒中', ['13-3', '13-4'], ['120']),
        ('chest', '胸口剧痛', ['13-7', '13-8'], ['120']),
        ('allergy', '过敏性休克', ['13-15'], ['120']),
        ('heat', '中暑', ['13-22', '13-23'], ['120']),
        ('crisis', '心理危机', ['01-25', '01-32'], ['12356']),
    ]

    out = []
    for key, name, refs, phones in cards:
        steps = []
        cites = []
        for rid in refs:
            it = by_id.get(rid)
            det = detail_by_id.get(rid)
            plain = full_plain.get(rid)
            if not it or not det or not plain:
                continue
            cites.append({'id': rid, 'title': it['t']})
            # 标题原文即最优先的动作指令，整句保留
            steps.append({'text': it['t'], 'cite': rid, 'lead': True})
            # 说人话按原句切分，只保留含动作指示的句子，句子本身不改写
            sentences = [s.strip() for s in re.split(r'(?<=。)', plain) if s.strip()]
            verbs = re.compile(r'(打|拨|先|别|不要|立刻|马上|按|压|冲|爬|叫|送|去|做|留|脱|关|开|躺|盖|停|带|换|喝|摘|记|找|问|趴|摸|走|用|把|让|拿|贴)')
            picked = [s for s in sentences if verbs.search(s)][:2]
            for s in picked:
                steps.append({'text': s, 'cite': rid, 'lead': False})
        out.append({
            'key': key,
            'name': name,
            'phones': phones,
            'steps': steps[:4],
            'cites': cites,
            'disclaimer': '本页文字摘自《高性价比人生指南》第 %s 条，未改写；不替代专业急救培训，以现场急救调度员指导为准。'
                          % '、'.join(c['id'] for c in cites),
        })
    return out, detail_by_id


def js(path, obj, header):
    payload = json.dumps(obj, ensure_ascii=False, separators=(',', ':'))
    with open(path, 'w', encoding='utf-8') as f:
        f.write('// %s\n// 由 tools/sync_content.py 生成，请勿手工编辑\n' % header)
        f.write('module.exports = %s;\n' % payload)
    return len(payload.encode('utf-8'))


def main():
    if not os.path.isdir(BOOK):
        print('找不到上游 book 目录：%s' % BOOK)
        sys.exit(1)

    sections, all_items = [], []
    for path in sorted(glob.glob(os.path.join(BOOK, '*.md'))):
        sec, items = parse_file(path)
        sections.append(sec)
        all_items.extend(items)

    aid, details = build_aid(sections, all_items)

    try:
        commit = subprocess.check_output(
            ['git', 'rev-parse', '--short', 'HEAD'],
            cwd=os.path.dirname(BOOK), stderr=subprocess.DEVNULL
        ).decode().strip()
    except Exception:
        commit = 'unknown'

    now = datetime.now().strftime('%Y-%m-%d %H:%M')
    size = {}
    size['catalog.js'] = js(os.path.join(BASE, 'data', 'catalog.js'), sections, '34 节目录')
    size['items.js'] = js(os.path.join(BASE, 'data', 'items.js'), all_items, '772 条精简索引')
    size['details.js'] = js(os.path.join(BASE, 'pkg-read', 'data', 'details.js'), details, '条目长文本')
    size['aid.js'] = js(os.path.join(BASE, 'pkg-aid', 'data', 'aid.js'), aid, '处境急救卡')
    size['meta.js'] = js(os.path.join(BASE, 'data', 'meta.js'), {
        'commit': commit,
        'builtAt': now,
        'sections': len(sections),
        'items': len(all_items),
        'aidCards': len(aid),
        'source': 'eternity4719/HowToLiveBetter · book/*.md',
        'license': 'CC BY-NC-SA 4.0（原书），派生数据仅供学习演示',
        'evidenceNotice': '证据类型为机器抽取，上线前须人工抽检 50 条',
    }, '数据版本')

    print('节 %d / 条目 %d / 急救卡 %d / 上游 %s' % (len(sections), len(all_items), len(aid), commit))
    for k, v in size.items():
        print('  %-12s %7.1f KB' % (k, v / 1024.0))
    print('  合计         %7.1f KB' % (sum(size.values()) / 1024.0))

    # 分包硬门槛：单个分包 2MB，给页面代码留 200KB 余量
    if size['details.js'] > 1850 * 1024:
        print('\n[警告] pkg-read 数据超过 1850KB，需按节拆到多个分包后再上线')
        sys.exit(2)
    if size['items.js'] > 900 * 1024:
        print('\n[警告] 主包索引超过 900KB，需进一步精简字段')
        sys.exit(2)


if __name__ == '__main__':
    main()
