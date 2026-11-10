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

/** 月度 IRR（二分法）：t=0 拿到 advance，t=1..n 每期付 payment。
 *  npv(r) 随 r 单调递增：r=0 时为 advance − 总还款，r 越大折现后还款越轻。 */
function monthlyIrr(advance, payment, n) {
  const npv = r => {
    let v = advance;
    for (let t = 1; t <= n; t += 1) v -= payment / Math.pow(1 + r, t);
    return v;
  };
  if (npv(0) >= 0) return null;          // 总还款不超过到手金额，等于免息
  let lo = 0, hi = 1;                    // 月利率上限 100%
  if (npv(hi) < 0) return null;
  for (let k = 0; k < 200; k += 1) {
    const mid = (lo + hi) / 2;
    if (npv(mid) < 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// 综合所得年度税率表（2019 年起）：上限 / 税率 / 速算扣除数
const TAX_BRACKETS = [
  { cap: 36000, rate: 0.03, quick: 0 },
  { cap: 144000, rate: 0.10, quick: 2520 },
  { cap: 300000, rate: 0.20, quick: 16920 },
  { cap: 420000, rate: 0.25, quick: 31920 },
  { cap: 660000, rate: 0.30, quick: 52920 },
  { cap: 960000, rate: 0.35, quick: 85920 },
  { cap: Infinity, rate: 0.45, quick: 181920 }
];

/** 年度综合所得个税（含速算扣除数） */
function incomeTax(taxable) {
  if (!(taxable > 0)) return 0;
  const b = TAX_BRACKETS.filter(x => taxable <= x.cap)[0];
  return taxable * b.rate - b.quick;
}


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

// ---------------- 5. 分期真实年化（IRR） ----------------

function calcInstallment(v) {
  const principal = Number(v.principal);
  const periods = Math.round(Number(v.periods));
  const payment = Number(v.payment);
  const fee = Number(v.fee) || 0;
  if (!(principal > 0) || !(periods > 0) || !(payment > 0) || fee < 0 || fee >= principal) return null;

  const advance = principal - fee;        // 实际到手
  const total = payment * periods;        // 总还款
  const cost = total - principal;         // 利息 + 手续费
  if (cost < 0) return null;

  const irr = monthlyIrr(advance, payment, periods);  // 月度内部收益率
  const ear = irr === null ? null : Math.pow(1 + irr, 12) - 1;
  const flatMonthly = cost / principal / periods * 100;

  const rows = [
    { label: '实际到手', value: money(advance) + ' 元', note: fee > 0 ? '本金 ' + money(principal) + ' 元先扣掉 ' + money(fee) + ' 元手续费。' : '没有前置手续费，到手就是本金。' },
    { label: '总还款', value: money(total) + ' 元', note: periods + ' 期 × 每期 ' + money(payment) + ' 元。' },
    { label: '多付的钱', value: money(cost) + ' 元', note: '占本金 ' + (cost / principal * 100).toFixed(1) + '%，这是你为「现在就能拿到」付的价格。' },
    { label: '账面费率', value: flatMonthly.toFixed(2) + '% / 月 · ' + (flatMonthly * 12).toFixed(1) + '% / 年', note: '销售常说的口径：总费用 ÷ 本金 ÷ 期数，再乘 12。看起来很低，但它不是利率。' },
    {
      label: '真实年化（IRR）',
      value: ear === null ? '免息' : (ear * 100).toFixed(2) + '%',
      note: irr === null
        ? '总还款没有超过到手金额，等于免息。'
        : '按每期实际占用的本金反解内部收益率再折成复利年化；通常是账面年费率的 ' + (flatMonthly > 0 ? (ear * 100 / (flatMonthly * 12)).toFixed(1) : '—') + ' 倍。'
    },
    {
      label: '口径',
      value: '现金流 IRR',
      note: '按等额本息现金流反解，不含逾期罚息、提前还款手续费与砍头息之外的其他费用；年化用复利口径（EAR）。'
    }
  ];
  return rows;
}

// ---------------- 6. 应急金能撑多久 ----------------

function calcEmergency(v) {
  const cash = Number(v.cash);
  const need = Number(v.need);
  const cut = Number(v.cut) || 0;
  const target = Number(v.target) || 6;
  if (!(cash >= 0) || !(need > 0) || cut < 0 || cut >= need) return null;

  const net = need - cut;                       // 失业后每月净消耗
  const months = cash / net;                    // 能撑几个月
  const targetCash = net * target;
  const gap = Math.max(0, targetCash - cash);

  let level, levelNote;
  if (months < 3) {
    level = '偏紧';
    levelNote = '不到 3 个月，一旦断收入就要立刻借钱或变卖资产。';
  } else if (months < 6) {
    level = '基本够用';
    levelNote = '够撑过一次普通求职周期，但遇到大病、搬家或行业寒冬仍会吃紧。';
  } else if (months < 12) {
    level = '稳健';
    levelNote = '覆盖大多数失业与换城市的过渡期。';
  } else {
    level = '很稳';
    levelNote = '除了失业，还能扛一次住院、修房或长期空窗。';
  }

  return [
    { label: '失业后每月净消耗', value: money(net) + ' 元', note: '必要支出 ' + money(need) + ' 元，减掉能砍掉的 ' + money(cut) + ' 元。' },
    { label: '能撑', value: months.toFixed(1) + ' 个月', note: '现金 ÷ 每月净消耗，不考虑这期间新进来的收入。' },
    { label: '目标 ' + target + ' 个月', value: money(targetCash) + ' 元', note: gap > 0 ? '还差 ' + money(gap) + ' 元才达标。' : '已经达标，多出 ' + money(cash - targetCash) + ' 元。' },
    { label: '评价', value: level, note: levelNote },
    { label: '口径', value: '只看现金流', note: '不含信用卡额度、亲友借款和可变现的长期资产；现金指随时能取出来的活期、货基与短期存款。' }
  ];
}

// ---------------- 7. 税后到手（工资薪金） ----------------

function calcSalary(v) {
  const salary = Number(v.salary);
  const ratio = Number(v.ratio);
  const deduction = Number(v.deduction) || 0;
  if (!(salary > 0) || ratio < 0 || ratio > 60 || deduction < 0) return null;

  const gross = salary * 12;
  const social = gross * ratio / 100;             // 个人承担的社保 + 公积金
  const taxable = gross - 60000 - social - deduction * 12;  // 年应纳税所得额
  const tax = incomeTax(taxable);
  const net = gross - social - tax;
  const burden = tax / gross * 100;

  return [
    { label: '全年社保公积金（个人）', value: money(social) + ' 元', note: '按税前年收入 × ' + ratio + '% 估算（养老 8% + 医疗 2% + 失业 0.5% + 公积金 5%–12%）。' },
    { label: '全年个税', value: money(tax) + ' 元', note: '综合所得年度税率表 + 速算扣除数，已扣 6 万起征点与专项附加扣除。' },
    { label: '年应纳税所得额', value: money(Math.max(0, taxable)) + ' 元', note: '税前 ' + money(gross) + ' − 6 万 − 社保公积金 − 专项附加扣除。' },
    { label: '月均到手', value: money(net / 12) + ' 元', note: '全年到手 ' + money(net) + ' 元 ÷ 12；年终奖、补贴与加班费另算。' },
    { label: '个税负担率', value: burden.toFixed(1) + '%', note: '个税 ÷ 税前年收入，加上社保后实际到手约 ' + (net / gross * 100).toFixed(1) + '%。' },
    { label: '口径', value: '年度汇算口径', note: '按综合所得年度汇算估算，未含缴费基数上下限、地方补贴差异、年终奖单独计税与劳务报酬等其他所得。' }
  ];
}

// ---------------- 8. 家庭保障缺口（DIME 法） ----------------

function calcProtection(v) {
  const debt = Number(v.debt) || 0;
  const expense = Number(v.expense);
  const years = Number(v.years) || 10;
  const edu = Number(v.edu) || 0;
  const assets = Number(v.assets) || 0;
  const insured = Number(v.insured) || 0;
  if (!(expense > 0) || debt < 0 || edu < 0 || assets < 0 || insured < 0 || !(years > 0)) return null;

  const incomeNeed = expense * years;
  const total = debt + incomeNeed + edu;
  const have = assets + insured;
  const gap = total - have;

  return [
    { label: '应备总额', value: money(total) + ' 元', note: '未还负债 ' + money(debt) + ' + 家庭支出 ' + money(expense) + '×' + years + ' 年 + 教育金 ' + money(edu) + '。' },
    { label: '已有可抵', value: money(have) + ' 元', note: '可动用资产 ' + money(assets) + ' + 已有寿险保额 ' + money(insured) + '。' },
    {
      label: '保障缺口',
      value: gap > 0 ? money(gap) + ' 元' : '已覆盖',
      note: gap > 0
        ? '相当于 ' + (gap / expense).toFixed(1) + ' 年家庭支出；这是「主要收入来源中断」时需要一次性补上的数。'
        : '现有资产与保额已经覆盖，多出 ' + money(-gap) + ' 元。'
    },
    {
      label: '支出覆盖年数',
      value: (have - debt - edu > 0 ? ((have - debt - edu) / expense).toFixed(1) + ' 年' : '不够抵负债'),
      note: '把负债和教育金先扣掉，剩下的钱够家里按现在的开销过几年。'
    },
    { label: '口径', value: 'DIME 法', note: '负债 + 收入 + 房贷 + 教育（Debt / Income / Mortgage / Education）减现有资产与保额；不推荐任何保险产品，费率与核保以保险公司为准。' }
  ];
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
  },
  {
    key: 'installment',
    name: '分期真实年化',
    back: '第 5 节',
    intro: '把「每月只要几百块」的分期，按每期实际占用的本金反解 IRR，还原成真实的年化成本。',
    fields: [
      { key: 'principal', label: '借款本金（元）', value: '12000' },
      { key: 'periods', label: '分期期数（月）', value: '12' },
      { key: 'payment', label: '每月还款（元）', value: '1080' },
      { key: 'fee', label: '一次性手续费 / 服务费（元）', value: '0' }
    ],
    invalid: '请检查输入：本金、期数、每月还款需为正数，手续费不能超过本金。',
    calc: calcInstallment
  },
  {
    key: 'emergency',
    name: '应急金能撑多久',
    back: '第 7 节',
    intro: '断收入后现金能撑几个月：按失业后的每月净消耗算，并对照 3 / 6 / 12 个月的行业常用线。',
    fields: [
      { key: 'cash', label: '能立刻动用的现金（元）', value: '50000' },
      { key: 'need', label: '每月必要支出（元）', value: '12000' },
      { key: 'cut', label: '失业后每月能砍掉的支出（元）', value: '2000' },
      {
        key: 'target', label: '目标月数', type: 'choice', value: '6',
        options: [{ value: '3', label: '3 个月' }, { value: '6', label: '6 个月' }, { value: '12', label: '12 个月' }]
      }
    ],
    invalid: '请检查输入：必要支出要大于 0，且必须大于能砍掉的那部分支出。',
    calc: calcEmergency
  },
  {
    key: 'salary',
    name: '税后到手',
    back: '第 5 节',
    intro: '按综合所得年度税率表 + 专项附加扣除，估算税前工资扣完社保与个税后每月到手多少。',
    fields: [
      { key: 'salary', label: '税前月薪（元）', value: '15000' },
      { key: 'ratio', label: '社保公积金个人比例（%）', value: '20' },
      { key: 'deduction', label: '专项附加扣除（元/月）', value: '2000' }
    ],
    invalid: '请检查输入：税前月薪要大于 0，个人缴纳比例不高于 60%。',
    calc: calcSalary
  },
  {
    key: 'protection',
    name: '家庭保障缺口',
    back: '第 7 节',
    intro: '用保险业通用的 DIME 法算「主要收入中断时要补多少钱」，只算缺口，不推荐产品。',
    fields: [
      { key: 'debt', label: '未还负债（房贷等，元）', value: '800000' },
      { key: 'expense', label: '家庭年支出（元）', value: '120000' },
      {
        key: 'years', label: '需要覆盖年数', type: 'choice', value: '10',
        options: [{ value: '5', label: '5 年' }, { value: '10', label: '10 年' }, { value: '15', label: '15 年' }]
      },
      { key: 'edu', label: '孩子教育金缺口（元）', value: '300000' },
      { key: 'assets', label: '可动用资产（元）', value: '200000' },
      { key: 'insured', label: '已有寿险保额（元）', value: '300000' }
    ],
    invalid: '请检查输入：家庭年支出要大于 0，各项金额不能为负。',
    calc: calcProtection
  }
];

module.exports = {
  MODELS,
  PENSION_MONTHS,
  TAX_BRACKETS,
  pensionMonthsOf,
  annuityPayment,
  annuityTotalInterest,
  equalPrincipal,
  monthlyIrr,
  incomeTax,
  money,
  monthText
};
