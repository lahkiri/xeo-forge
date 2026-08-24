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
