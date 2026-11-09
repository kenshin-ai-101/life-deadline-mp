// 事件模板与时限规则
// 重要：只有 PRD 第五章第 5 节「首批上线的 10 条」列为已核实/中/高的规则，
// 才允许带 deadline。其余事件一律以 actions 引用书中真实条目（itemId），
// 标注为「书中建议 · 无法定时限」，由用户自己决定要不要设提醒。
// 严禁在此文件里编写未核实的具体天数。规则更新须同步更新 verifiedAt 并重跑审核。

module.exports = {
  // 地方差异三档：决定文案强度，不可省略
  varianceLabel: {
    low: '各地基本一致',
    mid: '国家有规定，地方执行有差异',
    high: '完全由各地规定'
  },
  statusLabel: {
    verified: '已核实',
    mid: '有国家层面规定，地方执行不一',
    high: '完全由地方规定'
  },

  events: [
    {
      key: 'childbirth',
      name: '生孩子',
      badge: '生',
      desc: '从出院前办证到孩子参保，几件事有明确窗口。',
      anchorLabel: '孩子出生日',
      sections: [27, 20, 18],
      rules: [
        {
          id: 'birth-cert', eventType: 'childbirth',
          title: '出院前把出生医学证明办掉',
          deadline: { value: 0, unit: 'before_discharge', anchor: 'birth_date', obligor: '父母' },
          anchorMode: 'none',
          display: '出院前',
          materials: ['父母身份证', '提前想好的孩子姓名'],
          cost: '办证本身不收费',
          cite: '27-12',
          basis: '各地卫健部门出生医学证明管理规定',
          official: '分娩医院出生医学证明办理窗口 / 当地卫健委',
          variance: 'mid', status: 'mid', verifiedAt: '2026-11-09'
        },
        {
          id: 'newborn-insurance', eventType: 'childbirth',
          title: '给孩子办居民医保',
          deadline: { value: 0, unit: 'unknown', anchor: 'birth_date', obligor: '父母' },
          anchorMode: 'none',
          display: '各地不同，请查当地医保入口',
          materials: ['出生医学证明'],
          cost: '按当地居民医保标准缴费',
          cite: '27-14',
          basis: '各地城乡居民医保参保规定',
          official: '国家医保服务平台 / 当地医保局',
          variance: 'high', status: 'high', verifiedAt: '2026-11-09'
        },
        {
          id: 'maternity-leave', eventType: 'childbirth',
          title: '确认产假与生育津贴的申领方式',
          deadline: { value: 98, unit: 'day', anchor: 'birth_date', obligor: '单位' },
          anchorMode: 'event',
          materials: ['生育医学证明', '单位人事材料'],
          cost: '生育保险基金支付，个人不缴费',
          cite: '18-2',
          basis: '女职工劳动保护特别规定',
          official: '单位人事 / 当地社保经办机构',
          variance: 'low', status: 'verified', verifiedAt: '2026-11-09'
        }
      ],
      actions: ['20-2', '20-3', '01-14', '27-12', '27-14', '18-2']
    },
    {
      key: 'dismissal',
      name: '离职或被裁',
      badge: '离',
      desc: '先把材料留住，再看维权期限。',
      anchorLabel: '离职或收到解除通知日',
      sections: [19, 7],
      rules: [
        {
          id: 'labor-arbitration', eventType: 'dismissal',
          title: '申请劳动仲裁',
          deadline: { value: 1, unit: 'year', anchor: 'knowledge_date', obligor: '本人' },
          anchorMode: 'manual',
          anchorPrompt: '知道权利被侵害之日',
          materials: ['劳动合同', '解除通知书', '工资流水'],
          cost: '劳动仲裁不收费',
          cite: '08-19',
          basis: '劳动争议调解仲裁法',
          official: '当地劳动人事争议仲裁委员会',
          variance: 'low', status: 'verified', verifiedAt: '2026-11-09'
        },
        {
          id: 'labor-inspection-close', eventType: 'dismissal',
          title: '劳动监察投诉办结',
          deadline: { value: 60, unit: 'workday', anchor: 'filing_date', obligor: '人社部门' },
          anchorMode: 'manual',
          anchorPrompt: '立案日',
          materials: ['投诉受理回执'],
          cost: '不收费',
          cite: '07-2',
          basis: '劳动保障监察条例',
          official: '当地人社局劳动保障监察机构',
          variance: 'low', status: 'verified', verifiedAt: '2026-11-09'
        }
      ],
      actions: ['07-1', '07-2', '07-3', '07-12', '19-8', '19-17', '19-19']
    },
    {
      key: 'work_injury',
      name: '工伤或交通事故',
      badge: '伤',
      desc: '30 日内是单位办，单位不办你自己还有 1 年。',
      anchorLabel: '事故发生日',
      sections: [19, 13],
      rules: [
        {
          id: 'injury-apply', eventType: 'work_injury',
          title: '提交工伤认定申请',
          deadline: { value: 30, unit: 'day', anchor: 'accident_date', obligor: '单位' },
          anchorMode: 'event',
          fallback: { value: 1, unit: 'year', obligor: '本人或近亲属', ruleId: 'injury-self-apply' },
          materials: ['劳动关系证明', '诊断证明', '事故经过说明'],
          cost: '认定不收费',
          cite: '19-11',
          basis: '工伤保险条例第十七条',
          official: '当地人社局工伤认定窗口',
          variance: 'low', status: 'verified', verifiedAt: '2026-11-09'
        },
        {
          id: 'injury-self-apply', eventType: 'work_injury',
          title: '单位不办时自行申请工伤认定',
          deadline: { value: 1, unit: 'year', anchor: 'accident_date', obligor: '本人或近亲属' },
          anchorMode: 'event',
          materials: ['劳动关系证明', '诊断证明'],
          cost: '认定不收费',
          cite: '19-11',
          basis: '工伤保险条例第十七条',
          official: '当地人社局工伤认定窗口',
          variance: 'low', status: 'verified', verifiedAt: '2026-11-09'
        },
        {
          id: 'injury-decision', eventType: 'work_injury',
          title: '社保部门作出工伤认定决定',
          deadline: { value: 60, unit: 'day', anchor: 'acceptance_date', obligor: '社保部门' },
          anchorMode: 'manual',
          anchorPrompt: '受理日',
          materials: ['受理回执'],
          cost: '不收费',
          cite: '19-11',
          basis: '工伤保险条例第二十条',
          official: '当地人社局',
          variance: 'low', status: 'verified', verifiedAt: '2026-11-09'
        }
      ],
      actions: ['13-1', '13-12', '19-13', '19-11', '07-3']
    },
    {
      key: 'bereavement',
      name: '亲人去世',
      badge: '别',
      desc: '先开死亡证明，后面所有事都靠它。',
      anchorLabel: '去世日',
      sections: [25, 17],
      rules: [
        {
          id: 'bequest-accept', eventType: 'bereavement',
          title: '作出接受受遗赠的表示',
          deadline: { value: 60, unit: 'day', anchor: 'knowledge_date', obligor: '受遗赠人' },
          anchorMode: 'manual',
          anchorPrompt: '知道受遗赠之日',
          materials: ['遗嘱', '书面表示'],
          cost: '不收费',
          cite: '17-2',
          basis: '民法典',
          official: '公证机构 / 法院',
          variance: 'low', status: 'verified', verifiedAt: '2026-11-09'
        },
        {
          id: 'insurance-claim', eventType: 'bereavement',
          title: '人寿保险索赔',
          deadline: { value: 5, unit: 'year', anchor: 'knowledge_date', obligor: '受益人' },
          anchorMode: 'manual',
          anchorPrompt: '知道保险事故发生之日',
          materials: ['保单', '死亡证明', '关系证明'],
          cost: '不收费',
          cite: '25-2',
          basis: '保险法（人寿 5 年，其他险种 2 年）',
          official: '保险公司理赔窗口',
          variance: 'low', status: 'verified', verifiedAt: '2026-11-09'
        }
      ],
      actions: ['25-1', '25-2', '25-3', '25-5', '25-11', '25-12', '17-2']
    },
    {
      key: 'chronic',
      name: '确诊慢病',
      badge: '慢',
      desc: '书上给的是复查与用药节奏，不是法定时限。',
      anchorLabel: '确诊日',
      sections: [16, 24, 34],
      rules: [],
      actions: ['16-1', '16-2', '16-3', '16-4', '16-5', '16-7']
    },
    {
      key: 'relocation',
      name: '换城市换工作',
      badge: '迁',
      desc: '社保关系接着累计，别断在自己手里。',
      anchorLabel: '到新城市日',
      sections: [19, 15],
      rules: [],
      actions: ['19-19', '19-17', '19-8', '07-18', '15-16']
    },
    {
      key: 'housing',
      name: '买房收房',
      badge: '房',
      desc: '款项走监管账户，签约前先核产权。',
      anchorLabel: '签约日',
      sections: [15],
      rules: [],
      actions: ['15-6', '15-7', '15-16', '15-9']
    },
    {
      key: 'rental',
      name: '租房纠纷',
      badge: '租',
      desc: '先固定证据，再书面催告。',
      anchorLabel: '纠纷发生日',
      sections: [15, 8],
      rules: [],
      actions: ['15-1', '15-2', '15-3', '15-4', '15-5', '08-41']
    },
    {
      key: 'abroad',
      name: '出国',
      badge: '外',
      desc: '证件留底，保险覆盖全程。',
      anchorLabel: '出发日',
      sections: [21, 32],
      rules: [],
      actions: ['21-3', '21-4', '21-5', '21-7', '21-9', '32-4']
    },
    {
      key: 'elder65',
      name: '父母满 65',
      badge: '老',
      desc: '趁清醒把监护和遗嘱定下来。',
      anchorLabel: '生日',
      sections: [17, 33],
      rules: [],
      actions: ['17-1', '17-2', '17-7', '17-9', '17-13', '33-19']
    },
    {
      key: 'school',
      name: '孩子上学',
      badge: '学',
      desc: '户外两小时与视力复查，比报班更值得排进日程。',
      anchorLabel: '开学日',
      sections: [30, 31],
      rules: [],
      actions: ['30-4', '30-5', '30-6', '30-9', '30-11', '30-12']
    },
    {
      key: 'business',
      name: '开店开公司',
      badge: '业',
      desc: '证没下来别开张。',
      anchorLabel: '筹备起始日',
      sections: [12, 26],
      rules: [],
      actions: ['12-3', '12-4', '12-5', '12-6', '12-7', '12-12', '12-13']
    },
    {
      key: 'legal',
      name: '被传唤或被起诉',
      badge: '法',
      desc: '先请律师，不私了、不删记录。',
      anchorLabel: '收到文书日',
      sections: [8, 9],
      rules: [],
      actions: ['08-5', '08-19', '08-34', '08-36', '08-41']
    }
  ],

  // 长辈端常驻一键拨号（PRD 第五章第三节）
  hotlines: [
    { no: '120', label: '急救' },
    { no: '12356', label: '心理援助' },
    { no: '12333', label: '人社' },
    { no: '12393', label: '医保' }
  ],

  // 家庭成员主要状况选项（PRD：不采集姓名、身份证、手机号、病历）
  conditions: ['高血压', '糖尿病', '心脏病', '孕期', '术后', '认知下降', '无'],

  // 人群标签 -> 该做 / 别做 的映射规则（PRD 第五章第三节，按 who 字段匹配）
  // 实际清单由条目 cost.who 与关键词生成，此处只给筛选条件，不硬编码条目
  memberRules: [
    { key: 'senior', label: '60 岁以上', test: { minAge: 60 }, include: /骨密度|记忆门诊|跌倒|白内障|长期护理|意定监护|遗嘱|流感疫苗/, exclude: /布洛芬|擅自停/ },
    { key: 'pregnancy', label: '孕期', test: { condition: '孕期' }, include: /叶酸|三病筛查|产检|出生医学证明|生育津贴/, exclude: /布洛芬|自行用药/ },
    { key: 'toddler', label: '0 至 3 岁', test: { maxAge: 3 }, include: /疫苗|维生素 D|户外|视力筛查/, exclude: /阿司匹林|尼美舒利/ },
    { key: 'cognitive', label: '认知下降', test: { condition: '认知下降' }, include: /记忆门诊|走失|监护人/, exclude: /大额转账/ },
    { key: 'chronic', label: '慢病', test: { anyCondition: ['高血压', '糖尿病', '心脏病'] }, include: /复查|长处方|并发症|血压|血糖/, exclude: /自行减药|偏方/ }
  ]
};
