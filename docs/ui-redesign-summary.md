# Xeo Forge — Desktop UI Redesign

## النتيجة

تمت إعادة تنظيم واجهة إعدادات Xeo Forge لتعمل كـ **Control Plane** واضح لتطبيق سطح المكتب، مع الحفاظ على منطق التطبيق وواجهات API الحالية. أصبح الوصول إلى Providers وRuntime وProfiles وSkills وMCP وMemory من sidebar داخلي واحد، بدل عرض طويل غير مصنّف.

## التغييرات الأساسية

| المجال | ما تم تحسينه |
| --- | --- |
| Settings navigation | إضافة فهرس داخلي ثابت على سطح المكتب، يتحول إلى شريط أفقي قابل للتمرير على الشاشات الأصغر، مع أرقام تسلسلية وحالة نشطة واضحة. |
| Providers | إعادة تسمية قسم النموذج إلى Provider connection، وتحسين النصوص لتوضيح أن الاتصال النشط مشترك على مستوى مساحة العمل وأن المفاتيح لا تُعرض للمتصفح. |
| MCP | وضع MCP في قسم مستقل واضح مع وصف أمني مختصر، حقول command/args/env منظمة، وحالة enabled موحّدة. |
| Skills | إبراز Skill Studio كقسم Reusable workflows مستقل، مع توحيد الألوان والحقول والـ profile override. |
| Profiles | إبراز Profile Studio كقسم Reusable agent roles مستقل، مع لون برونزي هادئ بدل البنفسجي النيون. |
| Memory | تجميع Pinned instructions وPersistent memory وMemory inbox تحت قسم واحد واضح. |
| Visual system | اعتماد فواصل رفيعة، مسافات أوضح، رمادي فحمي دافئ، ونقطة تركيز amber واحدة. تمت إزالة الاعتماد البصري على cyan/purple neon والـ glow والبطاقات كثيرة الألوان. |
| Global shell | استبدال رموز التنقل الزخرفية بأرقام هندسية 01–04، وإبقاء rail العام ضيقًا مع تكامل أفضل مع sidebar الإعدادات. |
| Theme hydration | إضافة `suppressHydrationWarning` إلى RootLayout للتعامل الآمن مع theme bootstrap قبل أول paint. |

## الملفات المعدلة

`app/settings/SettingsClient.tsx`، `app/settings/McpStudio.tsx`، `app/settings/SkillStudio.tsx`، `app/settings/ProfileStudio.tsx`، `components/AppShell.tsx`، `app/globals.css`، و`app/layout.tsx`.

تم حفظ لقطات الشاشة في `docs/ui-screens/`، كما تم حفظ سجل البحث والتصميم في `docs/ui-redesign-research.md`.

## التحقق

تم تشغيل `npm run typecheck` بنجاح، وتم تشغيل `npm run build` بنجاح. كما تم فتح `/settings` محليًا في الوضعين الفاتح والداكن، وفحص الأقسام الرئيسية والجزء الخاص بـ Skills وMCP وMemory بصريًا. لم تظهر أخطاء تشغيلية مرتبطة بالتعديل؛ تحذير theme السابق عولج في RootLayout.

## مبدأ التصميم

> واجهة إعدادات احترافية لا تحتاج إلى إضاءة أو تدرجات لتبدو متقدمة؛ تحتاج إلى تسلسل بصري صامت، أسماء واضحة، حالة نشطة مفهومة، ومساحات تمنع ازدحام القرار.

اعتمدت البنية على مبادئ sidebar الحديثة: التدفق الرأسي القابل للمسح، التجميع، الفصل الدقيق بين الأقسام، والحالة النشطة الواضحة، كما توضحه مراجع تصميم الـ sidebar الحديثة [1]. استُخدم Hermes Desktop كمرجع معماري لتنظيم سطح المكتب وفصل إعدادات التطبيق عن مساحة العمل، مع الحفاظ على هوية Xeo Forge وعدم نسخ ألوان أو مكونات Hermes [2].

## المراجع

[1]: https://www.navbar.gallery/blog/best-side-bar-navigation-menu-design-examples "8+ Best Sidebar Menu Design Examples of 2026 — Navbar Gallery"

[2]: https://github.com/NousResearch/hermes-agent/tree/main/apps/desktop "Hermes Desktop — apps/desktop"

## الإصدار الثاني: Workspace موحدة

تم توحيد صفحة البداية في `/chat` إلى Workspace واحدة تحتوي على وضعين واضحين: **Chat** للاستكشاف واتخاذ القرار، و**Work** للتخطيط والتنفيذ المحكوم بالموافقة. يتبدل المحتوى داخل الصفحة نفسها؛ يظهر في Work إعداد project boundary وrole وworkflow والمرفقات قبل بدء التشغيل، بينما يبقى Chat هادئًا ومخصصًا للمحادثة فقط.

أصبح المسار `/work` يعيد التوجيه إلى `/chat` حتى لا توجد شاشة بدء ثانية، بينما بقي `/work/[id]` كتفصيل للجلسة المنفذة التي تحتوي على Run وActivity وProject وPreview وContext وMemory وTerminal وDiff.

أضيف أيضًا شريط **Quick setup** في Settings يوضح Provider وBrowser وRole وTools، مع روابط مباشرة إلى الأقسام المناسبة، لتقليل وقت الإعداد الأولي.

## تطبيق patterns Hermes — الجولة الجديدة

تم تطبيق نمط capabilities على MCP Studio: قائمة configured servers في master column، detail pane للخادم المحدد، حالة enabled/disabled، process/arguments، environment keys، approval note، وإضافة server في نفس surface. كما تمت ترقية composer في Workspace بإضافة Add context في Chat، attachment chips قابلة للإزالة، وحالة Approval-first في Work. أصبح mode قابلًا للفتح مباشرة عبر `/chat?mode=chat` أو `/chat?mode=work` حتى يمكن مشاركة السياق والعودة إليه.

تم التحقق بصريًا من Chat وWork بعد إعادة تشغيل خادم التطوير بوضع development. لقطات التحقق الحالية:
- `/home/ubuntu/screenshots/127_0_0_1_2026-08-24_22-20-54_5835.webp` — Chat
- `/home/ubuntu/screenshots/127_0_0_1_2026-08-24_22-20-40_4669.webp` — Work

تمت مراجعة Settings بعد تحديث MCP. القسم يعرض الآن MCP كـ Capabilities / MCP مع master column للخوادم وdetail pane للحالة والإضافة، وتظهر Quick setup وSettings sidebar في نفس الصفحة. لقطة التحقق: `/home/ubuntu/screenshots/127_0_0_1_2026-08-24_22-21-38_3240.webp`.

## Live Hermes comparison pass

تم تشغيل Hermes Desktop فعليًا عبر Electron وCDP، ثم إعادة تشكيل Workspace في Xeo Forge بناءً على الملاحظة الحية. التغييرات الحالية ليست مجرد palette swap؛ تم إخفاء sidebar العام داخل surfaces الكاملة، وإضافة workspace rail ثابتة تضم Xeo Forge وSessions وNew session وCapabilities وSettings وSkills وMCP tools، مع gateway state في footer. كما أصبح Light هو default theme مع accent أزرق هادئ أقرب إلى Hermes، وتحولت starter prompts من cards متكررة إلى flat rows مفصولة بخطوط دقيقة.

صور المراجعة الحالية:

| Surface | Path |
|---|---|
| Hermes runtime recovery / shell reference | `/home/ubuntu/hermes-reference/hermes-desktop-main.png` |
| Xeo Chat light | `/home/ubuntu/xeo-reference/workspace-chat-light.png` |
| Xeo Chat flat rows | `/home/ubuntu/xeo-reference/workspace-chat-flat.png` |
| Xeo Work light | `/home/ubuntu/xeo-reference/workspace-work-light.png` |
| Xeo Settings light | `/home/ubuntu/xeo-reference/settings-light-new.png` |

المعاينة الأخيرة أظهرت أن Xeo أصبح أقرب إلى desktop control surface: rail ثابتة، pane رئيسي، composer مثبت أسفل الشاشة، وSettings ذات split navigation واضح. ما يزال هناك مجال لتقليل حجم hero في Chat أكثر إذا احتجنا نسخة أكثر كثافة.

المراجعة النهائية للقطات Chat وWork أكدت أن shell أصبح أكثر اتزانًا: left rail ثابتة وهادئة، session/capability navigation واضحة، mode switch في header، composer مثبت أسفل surface، وWork setup ظاهر قبل التنفيذ. تم تثبيت Light كافتراضي ونجحت 699 اختبارات بعد التعديلات.
