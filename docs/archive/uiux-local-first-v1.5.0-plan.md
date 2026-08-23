# Xeo Forge v1.5.0 — Surface-Aware UI/UX

## القرار

الإصدار المقترح لهذه الحزمة هو **v1.5.0 — Surface-Aware Workbench**. يبقى Xeo Forge منتج SaaS على الويب، وتبقى فيه الهوية والحسابات والأرصدة وتعدد المستخدمين وAdmin ومسارات المصادقة. في المقابل، تكون نسخة Desktop تجربة **Local-First** مختلفة بوضوح: لا تعرض حسابًا أو رصيدًا أو اشتراكًا أو تعدد مستخدمين، وتدخل مباشرة إلى مساحة العمل المحلية.

هذا ليس حذفًا عامًا لبنية SaaS، بل فصل واضح حسب **runtime/surface**. لا يجوز أن يؤدي تحسين Desktop إلى كسر Web SaaS، ولا أن تتسرب مفردات SaaS إلى الواجهة المحلية.

## نتائج التدقيق

تحتوي الواجهة الحالية على أساس Chat/Work وIntent Gate وBrowser Profiles وOTA، لكنها تستخدم Chrome مشتركًا يحمل آثار SaaS في السطح المحلي. `AppShell` يعرض عناصر balance/account، وDashboard server wrapper يجلب الرصيد، وواجهات Login/Register/Admin قابلة للاكتشاف، و`SettingsClient` يجمع Browser وMemory وProfiles وSkills في صفحة طويلة. كذلك، مسار إنشاء المهام في `app/api/tasks/route.ts` يخصم من credits في planning/build، بينما `lib/auth/session.ts` ينشئ Local Owner ويضمن له credits داخليًا.

النتيجة: الإصلاح المطلوب end-to-end، وليس إعادة تسمية النصوص فقط. يجب أن يقرر التطبيق السلوك من Desktop Local Mode على الخادم، وأن تتبع الواجهة نفس القرار.

## مصفوفة السطحين

| المجال | SaaS Web | Desktop Local |
|---|---|---|
| الدخول | Login/Register وcookie sessions | دخول تلقائي إلى Local Owner داخليًا، بلا login wall |
| الهوية | حساب المستخدم، display name، sign out | `Local workspace` واسم الجهاز/المشروع عند الحاجة، بلا account chrome |
| الأرصدة | credits، daily grant، ledger، debit، حالة 402 | لا رصيد ظاهر ولا credit gate ولا رسالة billing |
| المستخدمون | تعدد المستخدمين وAdmin وإدارة المستخدمين | مستخدم محلي واحد داخلي، ولا Admin surface |
| Dashboard | Workbench SaaS مع حالة الحساب عند الحاجة | Workbench محلي يركز على المشروع والوكيل |
| Browser | Browser Profiles ضمن سياسة الويب | Browser Profile محلي مختار صراحةً، read-only افتراضيًا |
| Settings | إعدادات الحساب/النموذج/الاستضافة إن كانت موجودة | Agent behavior، Memory، Profiles، Skills، Browser، Workspace & updates |
| OTA | غير معروض إلا إذا كان runtime Desktop | شريط OTA مستقل مع الإصدار والحالة |
| التخزين | persistence الخاصة بالبيئة المستضافة | SQLite وuserData وproject path محلية |

## القواعد غير القابلة للكسر

أولًا، `isDesktopLocalMode()` هو مصدر القرار على الخادم، ولا يستنتج من وجود cookie أو من نص الواجهة. ثانيًا، لا تُرسل الواجهة المحلية balance أو account actions إلى العميل لمجرد إخفائها بـ CSS. ثالثًا، تُبقى جداول وممرات SaaS في المصدر ما دامت مطلوبة للويب، لكن كل route أو writer يحدد بوضوح هل يعمل في Local Mode أم Hosted Mode. رابعًا، لا تُحذف أعمدة credits أو users أو auth_sessions من SQLite في v1.5.0؛ أي حذف يحتاج migration مستقلة واختبار rollback.

## سلوك API المطلوب

في SaaS Web، يبقى `POST /api/tasks` محافظًا على credit debit وسلوك 402 ومسارات الحساب الحالية. في Desktop Local، لا يخصم إنشاء Chat أو Work أو Planning/Build من credits ولا يفشل بسبب رصيد محلي. يبقى إنشاء Local Owner داخليًا لأغراض owner-scoping والتوافق مع الجداول، لكن لا يُعامل كحساب SaaS في UI.

يجب أن يكون فصل الخصم في طبقة واضحة قابلة للاختبار، مثل helper server-side يقرر `shouldEnforceCredits()` من `isDesktopLocalMode()`. لا يُكرر الشرط في أكثر من route، ولا يُسمح بأن يخصم runner من Local Mode في خطوة لاحقة. يجب إضافة اختبارات للمسارين: Hosted يخصم ويرفض عند عدم كفاية الرصيد، وDesktop Local ينشئ المهمة ويشغلها دون ledger/debit.

## نظام UI/UX الجديد

### App Shell

يصبح الشريط الجانبي مختصرًا ومتمحورًا حول العمل: **Workbench**، **History**، **Control Center**. في Desktop Local يظهر `Local workspace` وحالة المشروع وBrowser Profile وOTA، وتختفي balance وsubscription وsign out وadmin. في Web SaaS تبقى عناصر الحساب والحسابات في موضعها المناسب، لكن لا تفرض على Workbench أن يبدو كلوحة billing.

### Workbench

تتكون الصفحة من composer واحد واضح، ومفتاح Chat/Work بارز، وسياق عمل مختصر يوضح project folder وBrowser Profile وprofile/skill عند اختيارها. لا تُعرض تفاصيل agent loop إلا عند الحاجة. Decision Card وعداد 30 ثانية يظهرا في Work فقط عندما يكتشف Intent Gate direct execution أو clarification، ولا يحولا كل محادثة إلى خطة.

### History

يُفصل سجل Chat وWork عن شاشة الإنشاء، مع عنوان المهمة ونوع السطح والحالة والمشروع وآخر نشاط. لا نضيف analytics أو dashboard SaaS جديدًا؛ الغرض هو استرجاع العمل المحلي أو السحابي بسرعة.

### Control Center

تُقسم الإعدادات إلى أقسام قصيرة: **Agent behavior**، **Memory**، **Profiles & skills**، **Browser**، **Workspace & updates**. في Web يمكن إبقاء إعدادات الحساب والاستضافة في مسار SaaS منفصل. في Desktop لا تعرض الصفحة إلا ما يعمل محليًا end-to-end.

### الحالات البصرية

يجب أن توجد حالات empty/loading/error/success واضحة، وأن تكون الأزرار المسؤولة عن Work وBrowser وOTA مرتبطة بمسارات تعمل فعليًا. لا نعرض badge أو card لمفهوم غير متاح في السطح الحالي. التصميم المطلوب أنظف وأقل كثافة، مع hierarchy أقوى ومساحات أفضل وcopy يشرح القرار بدل مصطلحات SaaS.

## التنفيذ المرحلي

### المرحلة A — Contract and route audit

تثبيت helper واحد للسلوك المحلي، وحصر كل استخدامات `credits` و`requireUser` و`admin` في routes وrunner وserver wrappers، ثم كتابة اختبارات baseline قبل تغيير الواجهة.

### المرحلة B — Desktop chrome

إعادة بناء `AppShell` وDashboard wrapper وDashboardClient حسب surface. إزالة balance/account chrome من Desktop دون تغيير Web SaaS، وإضافة local workspace context وproject/browser status بطريقة مفيدة.

### المرحلة C — Workbench redesign

إعادة تنظيم composer وChat/Work وDecision Card وproject context وHistory. الحفاظ على API وIntent Gate، وتحسين حالات الانتظار والنتائج والأخطاء والتأكيدات.

### المرحلة D — Control Center redesign

تقسيم Settings إلى أقسام واضحة، تبسيط Browser Profile وMemory وProfiles وSkills وOTA، وإزالة أي card SaaS من Desktop. كل section يجب أن يملك API ومسار persistence حقيقيًا.

### المرحلة E — Runtime behavior separation

فصل credit enforcement وaccount redirects وadmin visibility حسب Local/Web. إبقاء Hosted SaaS فعالًا، وحجب المسارات غير المناسبة في Desktop عبر redirect أو عدم عرضها، لا عبر حذف عشوائي من المشروع.

### المرحلة F — Verification and release

تشغيل `npm run typecheck`، الاختبارات الكاملة، `npm run build`، `npm run browser:smoke`، `npm run desktop:smoke`، و`git diff --check`. ثم تشغيل Desktop فعليًا وفحص فتحه المباشر، Chat، Work، Intent Gate، Browser Profile، SQLite، userData، project path، وOTA. تُحدّث docs وrelease notes ويُنشأ annotated tag بعنوان ووصف مخصصين.

## خارج نطاق v1.5.0

لا يدخل في هذه الحزمة Browser Computer الكامل متعدد التبويبات، أو domain allowlist الشاملة، أو automation المجدولة، أو Memory Foundation ذات lifecycle جديد، أو Model Routing، أو delegation. يمكن فقط تعديل ما يلزم للحفاظ على العقود الحالية وعدم تسرب SaaS إلى Desktop.

## بوابة القبول

يُقبل الإصدار عندما يبقى Web SaaS قادرًا على login/register وcredits وmulti-user/admin دون regressions، بينما يفتح Desktop مباشرة إلى Workbench محلي دون login، ولا يعرض balance أو billing أو multi-account أو Admin، ولا يمنع Work بسبب رصيد محلي. Chat وWork وIntent Gate وBrowser Profile وControl Center وOTA تعمل end-to-end، وتحافظ الترقية على SQLite وuserData وLocal Owner الداخلي وproject path وسجل المهام.

## خارطة 1.x

يبقى هذا الإصدار خطوة UX/Surface داخل خارطة v1.x حتى v1.10.0. بعد v1.5.0 يمكن تنفيذ Governed Safety، ثم Memory Foundation، Agent Evolution، Model Routing، Browser Computer، وAgent Operating Environment تدريجيًا، مع إبقاء SaaS Web وDesktop Local كسطحين مختلفين لا كمنتجين متضاربين.
