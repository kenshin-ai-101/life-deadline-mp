// 「我的」页 5 个统计数字的口径与明细。
// 统计卡与明细页共用本模块，避免两处算法漂移：改口径只改这里。
const store = require('./store.js');
const fmt = require('./format.js');

const TYPES = [
  {
    key: 'events', label: '进行中事件', short: '事件', unit: '个',
    hint: '状态为「进行中」的事件。这个事件下的动作全部办完后，会自动转为已完成。',
    empty: '还没有进行中的事件',
    emptyHint: '从首页选一件你遇到的事，就能生成一条带时限的时间轴。',
    cta: '去首页新建事件', tab: '/pages/index/index'
  },
  {
    key: 'tasks', label: '待办动作', short: '待办', unit: '条',
    hint: '清单里还没办完的动作，包含事件生成的时限动作，以及从知识库加入的零散待办。',
    empty: '还没有待办动作',
    emptyHint: '新建事件，或在知识库里把一条建议加入清单，就会出现在这里。',
    cta: '去看看清单', tab: '/pages/todo/todo'
  },
  {
    key: 'favorites', label: '收藏条目', short: '收藏', unit: '条',
    hint: '你在条目详情里点过收藏的建议，两本书的条目都算在内。',
    empty: '还没有收藏条目',
    emptyHint: '在知识库或搜索结果点开条目，按「收藏」就能存到这里。',
    cta: '去知识库逛逛', tab: '/pages/catalog/catalog'
  },
  {
    key: 'members', label: '家庭成员', short: '成员', unit: '位',
    hint: '你替家人建立的成员卡。数据只存在这台手机，没有绑定微信、没有上传。',
    empty: '还没有家庭成员',
    emptyHint: '在「家庭」tab 建一张成员卡，可以按年龄和身体情况筛出适配建议。',
    cta: '去家庭添加', tab: '/pages/family/family'
  },
  {
    key: 'receipts', label: '回执', short: '回执', unit: '张',
    hint: '办完动作后存下的凭证与备注，每张最多 5 张图，只记录本机图片路径。',
    empty: '还没有回执',
    emptyHint: '在时间轴里办完一个动作，点「存回执」记一笔，就能在这里翻看。',
    cta: '去看清单', tab: '/pages/todo/todo'
  }
];

function typeOf(key) {
  return TYPES.filter(t => t.key === key)[0] || TYPES[0];
}

/** 与「我的」页原有统计口径严格一致 */
function raw(key) {
  switch (key) {
    case 'events': return store.getEvents().filter(e => e.status === 'active');
    case 'tasks': return store.getOpenTasks().filter(t => t.status !== 'done');
    case 'favorites': return store.getFavorites();
    case 'members': return store.getMembers();
    case 'receipts': return store.getReceipts();
    default: return [];
  }
}

function countOf(key) { return raw(key).length; }

function stats() {
  return TYPES.map(t => ({ key: t.key, label: t.label, value: countOf(t.key) }));
}

function pad(n) { return (n < 10 ? '0' : '') + n; }

function timeLabel(ts) {
  if (!ts) return '时间未知';
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function taskUrl(t) {
  if (!t) return '';
  if (t.eventId) return '/pages/timeline/timeline?id=' + t.eventId;
  if (t.itemId) return '/pkg-read/detail/detail?id=' + t.itemId;
  return '';
}

function eventProgress(eventId) {
  const list = store.getTasks().filter(t => t.eventId === eventId);
  const done = list.filter(t => t.status === 'done' || t.status === 'archived').length;
  return done + ' / ' + list.length + ' 已办完';
}

/** 明细行统一结构：id / title / sub / tag / foot / url，回执另有 note / images */
function rowsOf(key) {
  switch (key) {
    case 'events':
      return raw('events')
        .slice()
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .map(e => ({
          id: e.id,
          title: e.name,
          sub: (e.anchorLabel || '计时起点') + ' · ' + (e.anchorDate || '未填')
            + (e.note ? ' · ' + e.note : ''),
          tag: eventProgress(e.id),
          foot: '',
          url: '/pages/timeline/timeline?id=' + e.id
        }));

    case 'tasks': {
      const events = store.getEvents();
      return raw('tasks').map(t => {
        const ev = t.eventId ? events.filter(e => e.id === t.eventId)[0] : null;
        const source = ev ? ev.name : (t.itemId ? '来自知识库 · 零散待办' : '零散待办');
        const when = t.deadline
          ? t.deadline + ' · ' + (t.deadlineLabel || '')
          : (t.deadlineLabel || '无期限');
        return {
          id: t.id,
          title: t.title,
          sub: source + ' · ' + when,
          tag: t.isOverdue ? '已过期' : (t.relLabel || t.statusText || '待办'),
          tone: t.isOverdue ? 'danger' : '',
          foot: t.basis || '',
          url: taskUrl(t)
        };
      });
    }

    case 'favorites':
      return raw('favorites').map(id => {
        const it = store.itemById(id);
        return {
          id: id,
          title: it ? it.t : '条目 ' + id,
          sub: fmt.bookTitleOf(id) + ' · '
            + (it ? fmt.sectionTitle(it.s, fmt.bookIdOf(id)) : '出处未知'),
          tag: '看原文',
          foot: it ? it.p : '这条可能来自旧版本内容',
          url: '/pkg-read/detail/detail?id=' + id
        };
      });

    case 'members':
      return raw('members').map(m => ({
        id: m.id,
        title: m.name || '未命名成员',
        sub: (m.age ? m.age + ' 岁' : '年龄未填') + ' · ' + (m.gender || '性别未填')
          + ' · ' + ((m.conditions || []).join('、') || '无特殊情况'),
        tag: m.bindStatus === 'unbound' ? '仅本机' : '已绑定',
        foot: '',
        url: '/pkg-family/member-detail/member-detail?id=' + m.id
      }));

    case 'receipts': {
      const tasks = store.getTasks();
      return raw('receipts').map(r => {
        const t = tasks.filter(x => x.id === r.taskId)[0];
        const images = r.images || [];
        return {
          id: r.id,
          title: t ? t.title : '关联动作已删除',
          sub: timeLabel(r.createdAt) + ' · ' + (images.length ? images.length + ' 张图片' : '无图片'),
          tag: images.length ? '展开看凭证' : '展开看备注',
          foot: t ? '' : '对应的动作已不在清单里',
          note: r.note || '没有写备注',
          images: images,
          hasImages: images.length > 0,
          url: taskUrl(t)
        };
      });
    }

    default: return [];
  }
}

module.exports = { TYPES, typeOf, raw, countOf, stats, rowsOf };
