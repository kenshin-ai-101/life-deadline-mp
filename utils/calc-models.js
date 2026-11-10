// 四个算账器的计算模型（纯函数，页面与 Node 冒烟测试共用）。
//
// 设计原则：
// 1) 能用现实规则算的，就按现实规则算，不用「单利近似」凑数：
//    - 养老保险：个人账户按国家《计发月数表》分摊，领取额按年度调整率复利增长，再按折现率还原成现值；
//    - 房贷：等额本息 / 等额本金两套真实摊销公式，提前还款分「减月供」和「缩期限」两种银行真实策略；
//    - 养育：按年龄阶段分段支出（学前 / 义务 / 高中），按通胀外推名义值，同时给出今天的购买力；
//    - 读书：逐年现金流（学费 + 少挣的机会成本 → 毕业后收入差），算回本时点与折现净现值。
// 2) 算不了的（未来利率、政策调整、个人涨薪曲线）不假装算得出，写进「口径」里，不给倾向性结论。
'use strict';

// ---------------- 通用工具 ----------------

/** 千分位金额 */
function money(n) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('zh-CN');
}

/** 月数 → 「139 个月 · 11.6 年」 */
function monthText(m) {
  if (!m) return '—';
  return m + ' 个月 · ' + (m / 12).toFixed(1) + ' 年';
}

/** 年利率百分数 → 月利率 */
function monthlyRate(annualPercent) { return Number(annualPercent) / 100 / 12; }

/** 等额本息月供：P 本金 / 年利率% / n 期 */
function annuityPayment(P, annualPercent, n) {
  const i = monthlyRate(annualPercent);
  if (!(n > 0)) return 0;
  if (!(i > 0)) return P / n;
  const f = Math.pow(1 + i, n);
  return P * i * f / (f - 1);
}

/** 等额本息：期数不变、月供重算 */
function annuityTotalInterest(P, annualPercent, n) {
  return annuityPayment(P, annualPercent, n) * n - P;
}

/** 等额本金：按 n 期摊完，返回首末月供与总利息（逐期求和，避免公式误差） */
function equalPrincipal(P, annualPercent, n) {
  const i = monthlyRate(annualPercent);
  const a = P / n;
  let total = 0;
  for (let k = 0; k < n; k += 1) total += (P - a * k) * i;
  return {
    first: a + P * i,
    last: a + a * i,
    monthlyPrincipal: a,
    totalInterest: total
  };
}

/** 等额本金：给定剩余本金 P2 与每月固定还本 a，还清需要的期数与总利息 */
function equalPrincipalByPrincipal(P2, annualPercent, a) {
  const i = monthlyRate(annualPercent);
  const n = Math.ceil(P2 / a);
  let total = 0, left = P2;
  for (let k = 0; k < n; k += 1) {
    const pay = Math.min(a, left);
    total += left * i;
    left -= pay;
    if (left <= 1e-6) break;
  }
  return { n: n, totalInterest: total };
}

// 国家统一的个人账户养老金「计发月数表」（劳社部发〔2005〕38 号附表，40–70 岁）
const PENSION_MONTHS = {
  40: 233, 41: 230, 42: 226, 43: 223, 44: 220, 45: 216, 46: 212, 47: 208, 48: 204, 49: 199,
  50: 195, 51: 190, 52: 185, 53: 180, 54: 175, 55: 170, 56: 164, 57: 158, 58: 152, 59: 145,
  60: 139, 61: 132, 62: 125, 63: 117, 64: 109, 65: 101, 66: 93, 67: 84, 68: 75, 69: 65, 70: 56
};

function pensionMonthsOf(age) { return PENSION_MONTHS[age] || PENSION_MONTHS[60]; }

// ---------------- 1. 养老保险回本 ----------------

function calcPension(v) {
  const age = Number(v.age) || 60;
  const paid = Number(v.paid);          // 个人账户累计储存额
  const monthly = Number(v.monthly);    // 退休后每月领到手的养老金
  const g = Number(v.growth) / 100;     // 养老金年度调整率
  const d = Number(v.discount) / 100;   // 折现率
  if (!(paid > 0) || !(monthly > 0)) return null;
  if (!(g > -0.5) || !(d > -0.5)) return null;

  const months = pensionMonthsOf(age);
  const acctMonthly = paid / months;   // 个人账户养老金 = 储存额 ÷ 计发月数

  // 名义回本：累计领取（含每年调待）首次覆盖个人账户储存额
  let nom = 0, tNom = 0;
  for (let m = 1; m <= 720; m += 1) {
    nom += monthly * Math.pow(1 + g, (m - 1) / 12);
    if (nom >= paid) { tNom = m; break; }
  }

  // 折现回本：把未来每一笔领取按折现率折回今天，再看现值何时追平缴费
  let pv = 0, tPv = 0;
  for (let m = 1; m <= 720; m += 1) {
    pv += monthly * Math.pow(1 + g, (m - 1) / 12) / Math.pow(1 + d, m / 12);
    if (pv >= paid) { tPv = m; break; }
  }

  const rows = [
    {
      label: '计发月数',
      value: months + ' 个月',
      note: age + ' 岁退休对应国家计发月数表；个人账户按这个月数分摊发放。'
    },
    {
      label: '个人账户养老金',
      value: money(acctMonthly) + ' 元/月',
      note: '个人账户储存额 ÷ 计发月数，是每月养老金里「自己的钱」那部分。'
    },
    {
      label: '个人账户回本',
      value: monthText(months),
      note: '制度设计上，计发月数就是把个人账户领完的月数，之后个人账户的钱由统筹继续发。'
    },
    {
      label: '名义回本（含调待）',
      value: tNom ? monthText(tNom) : '60 年内未回本',
      note: '按你填的每月领取额、每年上调 ' + Number(v.growth) + '% 累计，不折现。'
    },
    {
      label: '折现回本（今天的钱）',
      value: tPv ? monthText(tPv) : '60 年内未回本',
      note: '同一笔领取按 ' + Number(v.discount) + '% 折现率折回今天；折现后回本通常晚于名义回本。'
    },
    {
      label: '口径',
      value: '只算个人账户',
      note: '不含基础养老金（统筹部分）与过渡性养老金；调待、寿命、计发月数政策都可能变，实际以当地社保核定为准。'
    }
  ];
  return rows;
}

// ---------------- 2. 提前还房贷 ----------------

function calcMortgage(v) {
  const P = Number(v.principal);
  const rate = Number(v.rate);
  const n = Math.round(Number(v.months));
  const pre = Number(v.prepay);
  const method = v.method || 'annuity';       // annuity 等额本息 / equal 等额本金
  const strategy = v.strategy || 'shorten';   // shorten 缩期限 / reduce 减月供
  if (!(P > 0) || !(rate >= 0) || !(n > 0) || !(pre > 0) || pre >= P) return null;

  const P2 = P - pre;
  const rows = [];

  if (method === 'equal') {
    const base = equalPrincipal(P, rate, n);
    const ii = monthlyRate(rate);
    if (strategy === 'shorten') {
      // 月供不变 → 每月还本不变，期数自然缩短
      const next = equalPrincipalByPrincipal(P2, rate, base.monthlyPrincipal);
      const save = base.totalInterest - next.totalInterest;
      rows.push({ label: '当前月供', value: money(base.first) + ' 元起', note: '等额本金首月最高，之后每月递减，末月约 ' + money(base.last) + ' 元。' });
      rows.push({ label: '剩余应还利息', value: money(base.totalInterest) + ' 元', note: '按剩余 ' + n + ' 期、年利率 ' + rate + '% 逐期计息。' });
      rows.push({ label: '提前还款后可省利息', value: money(save) + ' 元', note: '月供保持 ' + money(base.monthlyPrincipal) + ' 元还本不变。' });
      rows.push({ label: '剩余期数', value: next.n + ' 期（缩短 ' + (n - next.n) + ' 期）', note: '相当于提前 ' + ((n - next.n) / 12).toFixed(1) + ' 年还清。' });
    } else {
      const next = equalPrincipal(P2, rate, n);
      const save = base.totalInterest - next.totalInterest;
      rows.push({ label: '当前月供', value: money(base.first) + ' 元起', note: '等额本金首月最高，之后每月递减。' });
      rows.push({ label: '剩余应还利息', value: money(base.totalInterest) + ' 元', note: '按剩余 ' + n + ' 期、年利率 ' + rate + '% 逐期计息。' });
      rows.push({ label: '提前还款后可省利息', value: money(save) + ' 元', note: '期限不变，每月还本从 ' + money(base.monthlyPrincipal) + ' 元降到 ' + money(next.monthlyPrincipal) + ' 元。' });
      rows.push({ label: '新月供', value: money(next.first) + ' 元起', note: '首月比原来少 ' + money(base.first - next.first) + ' 元，之后同样逐月递减。' });
    }
    rows.push({ label: '口径', value: '按剩余本金计息', note: '不含提前还款违约金、评估费与利率重定价；实际以银行还款计划书为准。' });
    return rows;
  }

  const pay = annuityPayment(P, rate, n);
  const totalInterest = pay * n - P;
  const i = monthlyRate(rate);

  if (strategy === 'shorten') {
    // 月供不变，反解期数：n' = ln(M / (M − i·P')) / ln(1+i)
    const denom = Math.log(1 + i);
    const ratio = pay / (pay - i * P2);
    const exact = i > 0 ? Math.log(ratio) / denom : P2 / pay;
    const n2 = Math.max(1, Math.ceil(exact - 1e-9));
    // 末月按实际余额结清，避免多算一期利息
    const k = n2 - 1;
    const fk = Math.pow(1 + i, k);
    const balance = P2 * fk - (i > 0 ? pay * (fk - 1) / i : pay * k);
    const lastPay = Math.max(0, balance * (1 + i));
    const newInterest = pay * k + lastPay - P2;
    const save = totalInterest - newInterest;
    rows.push({ label: '当前月供', value: money(pay) + ' 元', note: '等额本息：每月还款额固定，前期利息占比高。' });
    rows.push({ label: '剩余应还利息', value: money(totalInterest) + ' 元', note: '按剩余 ' + n + ' 期、年利率 ' + rate + '% 计算。' });
    rows.push({ label: '提前还款后可省利息', value: money(save) + ' 元', note: '月供不变，靠缩短期限省下来的利息。' });
    rows.push({ label: '剩余期数', value: n2 + ' 期（缩短 ' + (n - n2) + ' 期）', note: '相当于提前 ' + ((n - n2) / 12).toFixed(1) + ' 年还清，最后一期约 ' + money(lastPay) + ' 元。' });
  } else {
    const pay2 = annuityPayment(P2, rate, n);
    const newInterest = pay2 * n - P2;
    const save = totalInterest - newInterest;
    rows.push({ label: '当前月供', value: money(pay) + ' 元', note: '等额本息：每月还款额固定。' });
    rows.push({ label: '剩余应还利息', value: money(totalInterest) + ' 元', note: '按剩余 ' + n + ' 期、年利率 ' + rate + '% 计算。' });
    rows.push({ label: '提前还款后可省利息', value: money(save) + ' 元', note: '期限不变，月供从 ' + money(pay) + ' 元降到 ' + money(pay2) + ' 元。' });
    rows.push({ label: '新月供', value: money(pay2) + ' 元', note: '每月少还 ' + money(pay - pay2) + ' 元，还款压力立刻下降。' });
  }
  rows.push({ label: '口径', value: '真实摊销公式', note: '按月计息、逐期摊销，不含违约金、手续费与利率重定价；提前还款后银行可能要求重新签还款计划。' });
  return rows;
}

// ---------------- 3. 养孩子到 18 岁 ----------------

// 年龄分段（国家统计与家庭支出调查常用分法）：0–5 岁 6 年、6–14 岁 9 年、15–17 岁 3 年
const CHILD_PHASES = [
  { label: '0–5 岁（托育 / 幼儿园）', years: 6 },
  { label: '6–14 岁（义务教育）', years: 9 },
  { label: '15–17 岁（高中）', years: 3 }
];

function calcChild(v) {
  const base = [Number(v.p0), Number(v.p1), Number(v.p2)];
  const infl = Number(v.inflation) / 100;
  if (!(base[0] >= 0) || !(base[1] >= 0) || !(base[2] >= 0)) return null;
  if (!(base[0] + base[1] + base[2] > 0)) return null;
  if (!(infl > -0.5)) return null;

  let nominal = 0, year = 0, peak = 0, peakYear = 0, today = 0;
  CHILD_PHASES.forEach((ph, pi) => {
    for (let k = 0; k < ph.years; k += 1) {
      year += 1;
      const amount = base[pi] * Math.pow(1 + infl, year - 1); // 按今天的价格起算，逐年随通胀上浮
      nominal += amount;
      today += base[pi];
      if (amount > peak) { peak = amount; peakYear = year; }
    }
  });

  const rows = [
    { label: '18 年累计支出（名义）', value: money(nominal) + ' 元', note: '按你填的各阶段「今天的年支出」× 通胀逐年上浮后相加。' },
    { label: '折合今天的钱', value: money(today) + ' 元', note: '如果物价一直不变，这 18 年要花掉的钱；差额就是通胀的影响。' },
    { label: '年均支出（名义）', value: money(nominal / 18) + ' 元', note: '18 年平均，前期低、后期高，不能直接当作每年预算。' },
    { label: '最高一年', value: money(peak) + ' 元', note: '第 ' + peakYear + ' 年（约 ' + (peakYear - 1) + ' 岁），通常是高中阶段。' },
    { label: '口径', value: '按年龄分段', note: '不含择校费、留学、一次性大额支出与父母一方减少工作的收入损失；不折算投资收益。' }
  ];
  return rows;
}

// ---------------- 4. 读书还是打工 ----------------

function calcStudy(v) {
  const y = Math.round(Number(v.years));
  const fee = Number(v.fee);
  const loss = Number(v.loss);
  const gain = Number(v.gain);
  const work = Math.round(Number(v.work));
  const d = Number(v.discount) / 100;
  if (!(y > 0) || !(work > 0) || !(fee >= 0) || !(loss >= 0) || !(gain > 0) || !(d > -0.5)) return null;

  const perYearCost = fee + loss;
  const totalCost = perYearCost * y;

  // 逐年净现金流：读书期每年付出（学费 + 少挣），毕业后每年多挣
  let cum = 0, payback = 0;
  for (let t = 1; t <= y + work; t += 1) {
    const cf = t <= y ? -perYearCost : gain;
    const prev = cum;
    cum += cf;
    if (!payback && cum >= 0 && prev < 0) payback = t - 1 + (-prev) / cf;
  }

  let npv = 0;
  for (let t = 1; t <= y + work; t += 1) {
    const cf = t <= y ? -perYearCost : gain;
    npv += cf / Math.pow(1 + d, t);
  }

  const net = gain * work - totalCost;
  const rows = [
    { label: '读书期总投入', value: money(totalCost) + ' 元', note: y + ' 年 ×（每年学费 ' + money(fee) + ' + 每年少挣 ' + money(loss) + '）。' },
    {
      label: '回本时点',
      value: payback ? '第 ' + payback.toFixed(1) + ' 年' : '工作 ' + work + ' 年内未回本',
      note: payback
        ? '读书结束后再 ' + (payback - y).toFixed(1) + ' 年，累计收入差才补上总投入。'
        : '累计收入差始终没补上投入，说明按现在的数不划算（可以试着调高收入差或缩短学制）。'
    },
    { label: '工作 ' + work + ' 年净收益', value: money(net) + ' 元', note: '多挣的钱减去总投入，不折现。' },
    {
      label: '折现净现值（NPV）',
      value: money(npv) + ' 元',
      note: '按 ' + Number(v.discount) + '% 折现率把每年现金流折回今天；为负表示这笔「投资」按这个折现率不划算。'
    },
    { label: '口径', value: '只算收入差', note: '不含学费贷款利息、失业风险、涨薪曲线与行业周期；收入差按不变价，未计逐年涨薪。' }
  ];
  return rows;
}

// ---------------- 四个模型 ----------------

const MODELS = [
  {
    key: 'pension',
    name: '养老保险回本',
    back: '第 5 节',
    intro: '按个人账户「计发月数」+ 养老金年度调整 + 折现率算回本，和社保实际发放口径一致。',
    fields: [
      {
        key: 'age', label: '退休年龄', type: 'choice', value: '60',
        options: [{ value: '50', label: '50 岁' }, { value: '55', label: '55 岁' }, { value: '60', label: '60 岁' }, { value: '65', label: '65 岁' }]
      },
      { key: 'paid', label: '个人账户累计储存额（元）', value: '120000' },
      { key: 'monthly', label: '退休后每月领取（元）', value: '3000' },
      { key: 'growth', label: '养老金每年上调（%）', value: '3' },
      { key: 'discount', label: '折现率（%）', value: '2' }
    ],
    invalid: '请填正数：个人账户储存额和每月领取都要大于 0。',
    calc: calcPension
  },
  {
    key: 'mortgage',
    name: '提前还房贷',
    back: '第 15 节',
    intro: '用银行真实的等额本息 / 等额本金摊销公式，分别算「缩期限」和「减月供」两种提前还款方案。',
    fields: [
      { key: 'principal', label: '剩余本金（元）', value: '800000' },
      { key: 'rate', label: '年利率（%）', value: '3.5' },
      { key: 'months', label: '剩余期数（月）', value: '240' },
      { key: 'prepay', label: '打算提前还（元）', value: '100000' },
      {
        key: 'method', label: '还款方式', type: 'choice', value: 'annuity',
        options: [{ value: 'annuity', label: '等额本息' }, { value: 'equal', label: '等额本金' }]
      },
      {
        key: 'strategy', label: '提前还款后', type: 'choice', value: 'shorten',
        options: [{ value: 'shorten', label: '缩短期限（月供不变）' }, { value: 'reduce', label: '减少月供（期限不变）' }]
      }
    ],
    invalid: '请检查输入：本金、期数、提前还款额需为正数，且提前还款额要小于剩余本金。',
    calc: calcMortgage
  },
  {
    key: 'child',
    name: '养孩子到 18 岁',
    back: '第 18 节',
    intro: '孩子花钱不是一个固定数：按学前 / 义务教育 / 高中三段分别填，再按通胀逐年上浮。',
    fields: [
      { key: 'p0', label: '0–5 岁每年支出（元）', value: '30000' },
      { key: 'p1', label: '6–14 岁每年支出（元）', value: '20000' },
      { key: 'p2', label: '15–17 岁每年支出（元）', value: '35000' },
      { key: 'inflation', label: '年通胀率（%）', value: '2.5' }
    ],
    invalid: '三段年支出至少有一段大于 0，通胀率不要低于 -50%。',
    calc: calcChild
  },
  {
    key: 'study',
    name: '读书还是打工',
    back: '第 23 节',
    intro: '把学费和「少挣的钱」都算成投入，毕业后用收入差逐年回收，算回本时点和折现净现值。',
    fields: [
      { key: 'years', label: '读书年数', value: '4' },
      { key: 'fee', label: '每年学费（元）', value: '8000' },
      { key: 'loss', label: '读书期间每年少挣（元）', value: '60000' },
      { key: 'gain', label: '毕业后每年多挣（元）', value: '30000' },
      { key: 'work', label: '毕业后工作年数', value: '35' },
      { key: 'discount', label: '折现率（%）', value: '3' }
    ],
    invalid: '请检查输入：读书年数、工作年数、毕业后每年多挣都要大于 0，学费与少挣不能为负。',
    calc: calcStudy
  }
];

module.exports = {
  MODELS,
  PENSION_MONTHS,
  pensionMonthsOf,
  annuityPayment,
  annuityTotalInterest,
  equalPrincipal,
  money,
  monthText
};
