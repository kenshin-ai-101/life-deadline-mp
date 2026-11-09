// 日期与截止日计算。全部使用本地日历日，不依赖网络与节假日接口。
// 工作日规则只跳过周六周日；法定节假日表未内置，UI 必须显式提示「未含法定节假日」。

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

function format(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function parse(s) {
  if (typeof s !== 'string') return null;
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setHours(0, 0, 0, 0);
  return d;
}

function today() {
  var d = new Date();
  d.setHours(0, 0, 0, 0);
  return format(d);
}

function addDays(s, n) {
  var d = parse(s);
  if (!d) return null;
  d.setDate(d.getDate() + n);
  return format(d);
}

function addMonths(s, n) {
  var d = parse(s);
  if (!d) return null;
  var day = d.getDate();
  d.setMonth(d.getMonth() + n);
  if (d.getDate() < day) d.setDate(0); // 1月31日 +1月 -> 2月末
  return format(d);
}

function addYears(s, n) {
  return addMonths(s, n * 12);
}

function addWorkdays(s, n) {
  var d = parse(s);
  if (!d) return null;
  var left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    var w = d.getDay();
    if (w !== 0 && w !== 6) left -= 1;
  }
  return format(d);
}

function diffDays(fromStr, toStr) {
  var a = parse(fromStr), b = parse(toStr);
  if (!a || !b) return 0;
  return Math.round((b - a) / 86400000);
}

function weekday(s) {
  var d = parse(s);
  return d ? ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()] : '';
}

function shortDate(s) {
  if (!s) return '';
  var p = s.split('-');
  return Number(p[1]) + '月' + Number(p[2]) + '日';
}

// 相对今天的展示：不改数字，只给可核查的口径
function relativeLabel(deadline) {
  if (!deadline) return '';
  var n = diffDays(today(), deadline);
  if (n < 0) return '已过期 ' + Math.abs(n) + ' 天';
  if (n === 0) return '今天到期';
  if (n === 1) return '明天到期';
  return '还剩 ' + n + ' 天';
}

function bucket(deadline) {
  if (!deadline) return 'no_deadline';
  var n = diffDays(today(), deadline);
  if (n < 0) return 'overdue';
  if (n <= 7) return 'week';
  if (n <= 30) return 'month';
  return 'later';
}

/**
 * 依据规则计算截止日。
 * anchorMode:
 *   event  -> 以事件锚点日推算
 *   manual -> 计时起点需用户补填（受理日 / 立案日 / 知道权利被侵害之日）
 *   none   -> 不推算具体日期（出院前 / 各地不同）
 * 返回 { date, label, note, needsAnchor, workdayApprox }
 */
function computeDeadline(rule, anchorDate) {
  var dl = rule.deadline || {};
  var mode = rule.anchorMode || 'none';
  if (mode === 'none' || rule.variance === 'high') {
    return {
      date: null,
      label: rule.display || '各地不同，请查当地入口',
      note: rule.variance === 'high'
        ? '各地规定不同，本条不显示具体天数，请点下方官方入口核对。'
        : '本条以事件节点为准，不生成日历日期。',
      needsAnchor: false,
      workdayApprox: false
    };
  }
  if (mode === 'manual') {
    return {
      date: null,
      label: '计时起点待确认',
      note: '这条从「' + (rule.anchorPrompt || '另一事件日') + '」起算，不是从你填的事件日期起算，补填后才会显示倒计时。',
      needsAnchor: true,
      workdayApprox: dl.unit === 'workday'
    };
  }

  var date = null;
  var unit = dl.unit;
  if (unit === 'day') date = addDays(anchorDate, dl.value);
  else if (unit === 'workday') date = addWorkdays(anchorDate, dl.value);
  else if (unit === 'month') date = addMonths(anchorDate, dl.value);
  else if (unit === 'year') date = addYears(anchorDate, dl.value);

  if (!date) {
    return { date: null, label: '需人工核实', note: '规则时限单位未识别', needsAnchor: false, workdayApprox: false };
  }
  return {
    date: date,
    label: shortDate(date) + '（' + weekday(date) + '）',
    note: unit === 'workday'
      ? '按工作日估算，只跳过了周末，未扣除法定节假日，请以当地部门口径为准。'
      : '从 ' + shortDate(anchorDate) + ' 起算 ' + dl.value + ' ' + unitName(unit) + '。',
    needsAnchor: false,
    workdayApprox: unit === 'workday'
  };
}

function unitName(u) {
  return { day: '天', workday: '个工作日', month: '个月', year: '年' }[u] || u;
}

module.exports = {
  pad: pad, format: format, parse: parse, today: today,
  addDays: addDays, addMonths: addMonths, addYears: addYears, addWorkdays: addWorkdays,
  diffDays: diffDays, weekday: weekday, shortDate: shortDate,
  relativeLabel: relativeLabel, bucket: bucket,
  computeDeadline: computeDeadline, unitName: unitName
};
