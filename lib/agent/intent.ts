import type { TaskMode } from '../types';

export type IntentKind =
  | 'conversation'
  | 'explicit_plan'
  | 'direct_execution'
  | 'clarification_needed';

export type IntentDecisionReason =
  | 'ordinary_message'
  | 'explicit_planning_language'
  | 'explicit_execution_language'
  | 'ambiguous_execution_request';

export interface IntentDecision {
  kind: IntentKind;
  reason: IntentDecisionReason;
  confidence: number;
  summary: string;
  options?: Array<'direct' | 'plan'>;
}

/**
 * Language coverage note.
 *
 * `detectLanguage()` in loop.ts advertises en/ar/zh/ru/fr, so the intent router
 * must recognise action and planning language in all five — otherwise a Chinese
 * user typing "实现这个功能" falls through to `conversation` and Work silently
 * refuses to act on a direct request.
 *
 * CJK ALTERNATIONS MUST NOT USE `\b`. A word boundary is defined as a
 * transition between `\w` and non-`\w`, and CJK ideographs are not `\w`, so
 * `/\b完成\b/` matches only when the ideograph happens to sit next to ASCII —
 * essentially never in real Chinese text. `完成` used to sit inside the English
 * `\b`-anchored group for exactly this reason: it looked like coverage and was
 * dead. Scripts without word separators get their own unanchored, /u-flagged
 * patterns below.
 */
const PLAN_PATTERNS: RegExp[] = [
  /\b(plan|planning|propose a plan|draft a plan|map out|design first|analyze first)\b/i,
  /\b(create|write|prepare)\s+(?:a\s+)?(?:detailed\s+)?plan\b/i,
  /(خ(?:ط|طّ)ط|تخطيط|خطة|حلل|حلّل|اقترح خطة|صمم خطة|خطط أولا|خطط أولًا)/u,
  // zh — no word boundaries in Chinese; match the substrings directly.
  /(计划|規劃|规划|方案|先分析|先设计|先規劃|先规划|制定计划|拟一个计划|擬一個計畫|计画)/u,
  // ru — Cyrillic is \w under /u in modern V8, but keep these unanchored for
  // safety across inflected endings (планировать / план / спланируй).
  /(план|планир|спланир|продум|сначала проанализируй|сначала спроектируй)/iu,
  // fr — accented forms and the common imperative spellings.
  /(\bplanifie|\bplanifier|\bun plan\b|\bplan d[eu]\b|analyse d'abord|conçois d'abord|propose un plan)/iu,
];

const DIRECT_PATTERNS: RegExp[] = [
  /\b(do it|just do it|execute|implement|build|fix|change|edit|modify|create|run|ship)\b/i,
  // Software-work verbs that pair with a target noun ("add a function",
  // "update the test", "write a script"). Safe to treat as direct ONLY in
  // combination with a TARGET_PATTERN hit — the classifier already requires
  // explicitDirect && hasTarget, so bare "add some notes" stays conversational.
  /\b(add|update|write|refactor|delete|remove|install|generate|scaffold|set up|setup)\b/i,
  /\b(go ahead|make the change|apply the change|start working|take care of)\b/i,
  /(نفذ|نفّذ|اعمل|طب(?:ّ|ي)ق|إصلح|اصلح|عدّل|عدل|أنشئ|انشئ|شغّل|شغل|ابدأ التنفيذ|طبق التغيير)/u,
  // zh — execution verbs. `完成` lives here, where it can actually match.
  /(完成|执行|執行|实现|實現|修复|修複|修理|修改|创建|創建|新建|构建|建構|運行|运行|开始做|開始做|直接做|帮我改|幫我改|去做)/u,
  // ru — imperative and infinitive stems for the same verbs.
  /(сделай|выполни|реализуй|исправ|измени|поменяй|создай|запусти|собери|начни|примени)/iu,
  // fr — imperative/infinitive, with and without accents.
  // NOTE: \b is unreliable around accented capitals ("Écris…" at sentence
  // start never matches \bécrit): É is not \w, so the boundary collapses —
  // the same dead-pattern class the CJK note above warns about. Alternatives
  // that can begin with an accented letter are left unanchored.
  /(\bfais(-le)?\b|\bfaire\b|\bexécute|\bexecute|\bimplémente|\bimplemente|\bcorrige|\bmodifie|\bchange\b|\bcrée|\bcree\b|\blance\b|\bvas-y\b|\bconstruis|écrit?s?|ecrits?|créé?s?|cree?s?|\binstalle?\b|génère|genere|\bmets?\b|\bmettez\b)/iu,
];

const QUESTION_PATTERNS: RegExp[] = [
  /\b(can you|could you|would you|what|how|why|which|should i)\b/i,
  /(هل|كيف|لماذا|ما هو|ماذا|أي|هل يمكنك)/u,
  // zh — interrogatives plus the sentence-final question particle 吗/嗎.
  /(吗|嗎|什么|什麼|怎么|怎麼|为什么|為什麼|哪个|哪個|是否|可以.*吗|能不能)/u,
  // ru
  /(\bчто\b|\bкак\b|\bпочему\b|\bзачем\b|\bкакой\b|\bкакая\b|\bможно ли\b|\bможешь ли\b|\bстоит ли\b)/iu,
  // fr
  /(\bqu(?:e|oi|el|elle)\b|\bcomment\b|\bpourquoi\b|\best-ce que\b|\bpeux-tu\b|\bpourrais-tu\b|\bdevrais-je\b)/iu,
];

const TARGET_PATTERNS: RegExp[] = [
  // Software-work nouns a direct request most often names. Kept conservative:
  // generic words ("thing", "it") stay out so they cannot fabricate a target.
  /\b(file|folder|project|code|app|website|browser|page|repository|repo|component|api|database|script|feature|bug|test|tests|suite|function|module|package|library|endpoint|route|service|config|dependency|dependencies)\b/i,
  /(ملف|مجلد|مشروع|كود|تطبيق|موقع|متصفح|صفحة|مستودع|قاعدة بيانات|سكربت|سكرِبت|خاصية|ميزة|خطأ|وظيفة|دالة|اختبار|حزمة|خدمة)/u,
  // zh
  /(文件|檔案|文件夹|文件夾|目录|目錄|项目|項目|专案|專案|代码|程式碼|代碼|应用|應用|网站|網站|浏览器|瀏覽器|页面|頁面|仓库|倉庫|组件|組件|元件|接口|介面|数据库|資料庫|函数|函數|脚本|腳本|功能|缺陷|测试|測試|模块|模組|包|库|庫|服务|服務)/u,
  // ru
  /(файл|папк|проект|код|приложени|сайт|браузер|страниц|репозитор|компонент|api|база данных|базу данных|скрипт|функци|фича|баг|тест|тесты|модул|пакет|библиотек|сервис|зависимост)/iu,
  // fr
  /(\bfichier|\bdossier|\bprojet|\bcode\b|\bapplication|\bsite\b|\bnavigateur|\bpage\b|\bdépôt|\bdepot\b|\bcomposant|\bapi\b|\bbase de données|\bscript|\bfonction|\bbug\b|\btest(s)?\b|\bmodule|\bbibliothèque|\bservice\b)/iu,
];

function normalize(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function hasAny(patterns: RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Classifies the user's first Work turn without invoking the model or starting
 * a runner. This is intentionally conservative: ambiguity becomes a visible
 * choice, never silent execution.
 */
export function classifyWorkIntent(input: string): IntentDecision {
  const text = normalize(input);
  const explicitPlan = hasAny(PLAN_PATTERNS, text);
  const explicitDirect = hasAny(DIRECT_PATTERNS, text);
  const questionLike = hasAny(QUESTION_PATTERNS, text);
  const hasTarget = hasAny(TARGET_PATTERNS, text);

  if (explicitPlan && !explicitDirect) {
    return {
      kind: 'explicit_plan',
      reason: 'explicit_planning_language',
      confidence: 0.98,
      summary: 'The user explicitly asked for a plan before execution.',
    };
  }

  if (explicitDirect && hasTarget && !questionLike) {
    return {
      kind: 'direct_execution',
      reason: 'explicit_execution_language',
      confidence: 0.94,
      summary: 'The user appears to request a concrete change or action.',
      options: ['direct', 'plan'],
    };
  }

  if (explicitDirect && (questionLike || !hasTarget)) {
    return {
      kind: 'clarification_needed',
      reason: 'ambiguous_execution_request',
      confidence: 0.72,
      summary: 'The request contains action language but its target or intent is not sufficiently clear.',
      options: ['direct', 'plan'],
    };
  }

  return {
    kind: 'conversation',
    reason: 'ordinary_message',
    confidence: 0.9,
    summary: 'The message is conversational and should not start planning or execution.',
  };
}

/** Maps an explicit planning decision to the existing execution mode. */
export function modeForIntent(kind: IntentKind): Extract<TaskMode, 'chat' | 'planning'> {
  return kind === 'explicit_plan' ? 'planning' : 'chat';
}

export function directExecutionBrief(goal: string): string {
  return JSON.stringify({
    kind: 'direct_execution',
    request: normalize(goal),
    contract: 'Execute only the requested scope. Do not expand the goal or rewrite this brief.',
    created_at: new Date().toISOString(),
  });
}
