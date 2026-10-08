// Exploratory, author-labeled families; no independent label adjudication.
// Each tuple fixes current work, a paraphrase, an opposite and an extension.
const families = [
  ['archive', 'Automatically archive inactive workspaces after 90 days.', 'Move workspaces unused for three months to the archive.', 'Keep inactive workspaces out of the archive.', 'ארכב אוטומטית סביבות עבודה לא פעילות אחרי 90 ימים.', 'העבר לארכיון סביבות עבודה שלא היו בשימוש שלושה חודשים.', 'השאר סביבות עבודה לא פעילות מחוץ לארכיון.'],
  ['inventory', 'Reserve inventory units when an order is placed.', 'Set aside stock as soon as a customer orders.', 'Do not reserve stock when orders are placed.', 'שריין יחידות מלאי בעת ביצוע הזמנה.', 'הקצה מלאי מיד כשהלקוח מזמין.', 'אל תשריין מלאי בעת ביצוע הזמנה.'],
  ['media', 'Strip location metadata from uploaded photos.', 'Remove GPS coordinates before storing user pictures.', 'Keep location metadata on uploaded photos.', 'הסר מטא נתוני מיקום מתמונות שהועלו.', 'מחק קואורדינטות GPS לפני שמירת תמונות המשתמש.', 'שמור מטא נתוני מיקום בתמונות שהועלו.'],
  ['billing', 'Prorate subscription charges when upgrading mid-month.', 'Charge only the remaining part of the month for a subscription upgrade.', 'Charge a full month for mid-month upgrades.', 'חשב חיוב יחסי בשדרוג מנוי באמצע החודש.', 'חייב רק על יתרת החודש בעת שדרוג מנוי.', 'חייב חודש מלא בשדרוג מנוי באמצע החודש.'],
  ['search', 'Exclude private documents from public search results.', 'Hide confidential files in searches performed by visitors.', 'Include private documents in public search results.', 'החרג מסמכים פרטיים מתוצאות חיפוש ציבוריות.', 'הסתר קבצים חסויים בחיפוש שמבצעים מבקרים.', 'כלול מסמכים פרטיים בתוצאות חיפוש ציבוריות.'],
  ['jobs', 'Retry failed jobs at most three times.', 'Give a failed background job no more than three further attempts.', 'Never retry failed jobs.', 'נסה מחדש עבודות שנכשלו לכל היותר שלוש פעמים.', 'תן למשימת רקע שנכשלה עד שלושה ניסיונות נוספים.', 'לעולם אל תנסה מחדש עבודות שנכשלו.'],
  ['calendar', 'Show appointment times in the viewer time zone.', 'Convert booking hours to each viewer local time.', 'Always show appointment times in UTC.', 'הצג מועדי פגישות באזור הזמן של הצופה.', 'המר שעות הזמנה לשעה המקומית של כל צופה.', 'הצג תמיד מועדי פגישות ב־UTC.'],
  ['webhooks', 'Reject webhook deliveries with an invalid signature.', 'Refuse incoming callbacks unless their signature is valid.', 'Accept webhook deliveries with invalid signatures.', 'דחה מסירת webhook עם חתימה לא תקינה.', 'סרב לקבל callbacks נכנסים אלא אם החתימה תקפה.', 'קבל מסירת webhook עם חתימות לא תקינות.'],
  ['editor', 'Save document drafts every 20 seconds.', 'Persist unsaved writing automatically at twenty-second intervals.', 'Disable automatic saving of document drafts.', 'שמור טיוטות מסמכים כל 20 שניות.', 'שמור אוטומטית כתיבה שלא נשמרה במרווחים של עשרים שניות.', 'בטל שמירה אוטומטית של טיוטות מסמכים.'],
  ['delivery', 'Require a one-time code before handing over a parcel.', 'Verify a single-use PIN before releasing a shipment.', 'Hand over parcels without a one-time code.', 'דרוש קוד חד פעמי לפני מסירת חבילה.', 'אמת PIN לשימוש יחיד לפני שחרור משלוח.', 'מסור חבילות ללא קוד חד פעמי.'],
  ['reports', 'Round monetary totals to two decimal places.', 'Display money amounts with exactly two digits after the decimal point.', 'Round monetary totals to whole integers.', 'עגל סכומים כספיים לשתי ספרות אחרי הנקודה.', 'הצג סכומי כסף עם שתי ספרות בדיוק אחרי הנקודה העשרונית.', 'עגל סכומים כספיים למספרים שלמים.'],
  ['consent', 'Ask permission before collecting usage analytics.', 'Collect interaction telemetry only after the user opts in.', 'Collect usage analytics without asking permission.', 'בקש רשות לפני איסוף נתוני שימוש.', 'אסוף טלמטריית אינטראקציות רק אחרי הסכמת המשתמש.', 'אסוף נתוני שימוש ללא בקשת רשות.'],
  ['reviews', 'Let customers edit a review for seven days.', 'Allow changing submitted feedback during the first week.', 'Prevent customers from editing submitted reviews.', 'אפשר ללקוחות לערוך ביקורת במשך שבעה ימים.', 'אפשר שינוי משוב שנשלח במהלך השבוע הראשון.', 'מנע מלקוחות לערוך ביקורות שנשלחו.'],
  ['sessions', 'Revoke active sessions when a password is reset.', 'Sign out all logged-in devices after resetting a password.', 'Keep active sessions after a password reset.', 'בטל סשנים פעילים בעת איפוס סיסמה.', 'נתק את כל המכשירים המחוברים לאחר איפוס סיסמה.', 'שמור סשנים פעילים אחרי איפוס סיסמה.'],
  ['attachments', 'Block executable attachments in support tickets.', 'Disallow program files attached to helpdesk requests.', 'Allow executable attachments in support tickets.', 'חסום קבצים מצורפים הניתנים להרצה בפניות תמיכה.', 'אל תאפשר קובצי תוכנה המצורפים לפניות למוקד התמיכה.', 'אפשר קבצים מצורפים הניתנים להרצה בפניות תמיכה.'],
  ['streams', 'Drop duplicate events using their event identifier.', 'Discard repeated messages that carry the same event ID.', 'Process duplicate events every time they arrive.', 'דלג על אירועים כפולים לפי מזהה האירוע.', 'זרוק הודעות חוזרות שנושאות את אותו מזהה אירוע.', 'עבד אירועים כפולים בכל פעם שהם מגיעים.'],
  ['routing', 'Redirect retired article URLs to their replacements.', 'Send visitors from obsolete article links to the new pages.', 'Return an error for retired article URLs.', 'הפנה כתובות מאמרים שיצאו משימוש למחליפות שלהן.', 'שלח מבקרים מקישורי מאמרים מיושנים לעמודים החדשים.', 'החזר שגיאה לכתובות מאמרים שיצאו משימוש.'],
  ['accessibility', 'Announce form validation errors to screen readers.', 'Read input error messages aloud through assistive technology.', 'Hide form validation errors from screen readers.', 'הכרז על שגיאות אימות טופס לקוראי מסך.', 'הקרא הודעות שגיאה בקלט באמצעות טכנולוגיה מסייעת.', 'הסתר שגיאות אימות טופס מקוראי מסך.'],
  ['builds', 'Stop deployment when integration checks fail.', 'Prevent shipping a release if the integration tests are red.', 'Deploy even when integration checks fail.', 'עצור פריסה כשבדיקות אינטגרציה נכשלות.', 'מנע שחרור גרסה אם בדיקות האינטגרציה אדומות.', 'בצע פריסה גם כשבדיקות אינטגרציה נכשלות.'],
  ['quotas', 'Limit each account to ten active projects.', 'Cap simultaneously running projects at ten per account.', 'Allow unlimited active projects per account.', 'הגבל כל חשבון לעשרה פרויקטים פעילים.', 'קבע תקרה של עשרה פרויקטים פעילים במקביל לכל חשבון.', 'אפשר מספר בלתי מוגבל של פרויקטים פעילים לכל חשבון.'],
  ['maps', 'Cache map tiles for offline browsing.', 'Store mapping images so the map can be viewed without a network.', 'Require a network connection to view map tiles.', 'שמור אריחי מפה במטמון לגלישה לא מקוונת.', 'אחסן תמונות מיפוי כדי להציג מפה ללא רשת.', 'דרוש חיבור רשת לצפייה באריחי מפה.'],
  ['imports', 'Validate an entire batch before inserting any rows.', 'Check every incoming record before writing the batch to storage.', 'Insert rows before validating the whole batch.', 'אמת את כל האצווה לפני הוספת רשומות כלשהן.', 'בדוק כל רשומה נכנסת לפני כתיבת האצווה לאחסון.', 'הוסף רשומות לפני אימות האצווה כולה.'],
  ['catalog', 'Hide products that are out of stock.', 'Remove unavailable items from the visible product listing.', 'Show products even when they are out of stock.', 'הסתר מוצרים שאזלו מהמלאי.', 'הסר פריטים שאינם זמינים מרשימת המוצרים הגלויה.', 'הצג מוצרים גם כשהם אזלו מהמלאי.'],
  ['retention', 'Erase abandoned uploads after 48 hours.', 'Delete unfinished file transfers after two days.', 'Keep abandoned uploads indefinitely.', 'מחק העלאות שננטשו אחרי 48 שעות.', 'הסר העברות קבצים שלא הסתיימו לאחר יומיים.', 'שמור העלאות שננטשו ללא הגבלת זמן.'],
];

export function semanticCorpus() {
  const tasks = {en: [], he: []}, queries = [], pairs = [];
  families.forEach(([scope, en, paraphraseEn, oppositeEn, he, paraphraseHe, oppositeHe], family) => {
    const split = family < 8 ? 'calibration' : 'test';
    for (const language of ['en', 'he']) {
      const text = language === 'en' ? en : he;
      const opposite = language === 'en' ? oppositeEn : oppositeHe;
      const extension = text + (language === 'en' ? ' Also send a daily summary email.' : ' בנוסף שלח אימייל סיכום יומי.');
      for (const [kind, title, status, version] of [
        ['current', text, family % 2 ? 'verified' : 'backlog', 'v2'],
        ['opposite', opposite, 'backlog', 'v2'],
        ['extension', extension, 'backlog', 'v2'],
        ['old', text, family % 2 ? 'cancelled' : 'superseded', 'v1'],
      ]) tasks[language].push({id: `${scope}-${kind}`, family, title, scope, version, status});
    }
    for (const language of ['en', 'he', 'cross']) {
      const store = language === 'he' ? 'he' : 'en';
      const q = language === 'en' ? paraphraseEn : paraphraseHe;
      const a = language === 'en' ? `I will implement the requested behavior: ${q}` : `אממש את ההתנהגות שביקשת: ${q}`;
      const wrong = language === 'en' ? `I will instead implement: ${oppositeEn}` : `במקום זאת אממש: ${oppositeHe}`;
      for (const [scenario, answer, gold] of [['faithful', a, `${scope}-current`], ['misleading', wrong, `${scope}-current`], ['no-match', a, null]]) {
        const request = scenario === 'no-match' ? (language === 'en' ? `Add a keyboard shortcut to open the ${scope} settings panel.` : `הוסף קיצור מקלדת לפתיחת מסך ההגדרות של ${scope}.`) : q;
        queries.push({id: `${family}-${language}-${scenario}`, family, split, language, store, scenario, q: request, a: scenario === 'no-match' ? (language === 'en' ? `I will add the requested keyboard shortcut for ${scope}.` : `אוסיף את קיצור המקלדת שביקשת עבור ${scope}.`) : answer, scope, version:'v2', gold});
      }
      for (const [relation, request] of [['same', q], ['overlap', q + (language === 'en' ? ' Also send a daily summary email.' : ' בנוסף שלח אימייל סיכום יומי.')], ['different-opposite', language === 'en' ? oppositeEn : oppositeHe], ['different-version', q]]) {
        pairs.push({id:`${family}-${language}-${relation}`, family, split, language, relation, identity:relation === 'same', left: tasks[store].find(t=>t.id === `${scope}-current`).title + ' API v2', right: request + (relation === 'different-version' ? ' API v3' : ' API v2')});
      }
    }
  });
  return {tasks, queries, pairs};
}

export function history(base, size, language) {
  const tasks = base.map(x=>({...x}));
  const opsEn = ['Validate invoice references', 'Rotate service certificates', 'Render shipment labels', 'Monitor database lag', 'Resize product thumbnails', 'Sort event timestamps', 'Calculate tax rebates', 'Parse calendar attachments'];
  const opsHe = ['אמת הפניות לחשבוניות', 'החלף תעודות שירות', 'הצג תוויות משלוח', 'נטר פיגור במסד הנתונים', 'הקטן תמונות מוצרים', 'מיין זמני אירועים', 'חשב החזרי מס', 'פענח קבצים מצורפים ליומן'];
  for(let i=tasks.length;i<size;i++) tasks.push({id:`distractor-${i}`, family:null, title:`${(language==='en'?opsEn:opsHe)[i%8]} ${language==='en'?'for service':'עבור שירות'} svc-${(i*97)%997} ${language==='en'?'with limit':'עם הגבלה'} ${3+i%51}.`, scope:`service-${i%997}`, version:`v${1+i%4}`, status:['backlog','verified','cancelled','superseded'][i%4]});
  // A fixed permutation prevents positive targets winning equal-score ties by construction.
  return tasks.map((task,i)=>({task,key:((i+1)*2654435761)>>>0})).sort((a,b)=>a.key-b.key).map(x=>x.task);
}

export const projectText = t => `${t.title}\nScope: ${t.scope}\nAPI: ${t.version}\nStatus: ${t.status}`;
export function markdownStore(tasks) { return tasks.map(t=>`## ${t.id}\n${JSON.stringify(t)}\n`).join('\n'); }
export function parseMarkdown(text) { return text.split('\n').filter(x=>x.startsWith('{')).map(x=>JSON.parse(x)); }
