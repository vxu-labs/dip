import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {ensure,taskRead} from '../src/core.js';
import {history,projectText} from './semantic-corpus.mjs';
const fixtures=[
  ['task_2362d29e-7f1b-4f76-8d38-43fbaf961335','Reduce the size of preparation and adoption tool responses and measure schema overhead.','צמצם את הפלט של כלי ההכנה ואימוץ המשימות ומדוד את עלות סכמות הכלים.'],
  ['task_684b230686f33a194d0cf09079e991f477c74329fba46b022f19b1bb89213344','Check trusted plan capture, interruption and context compression in real coding hosts.','בדוק קליטת תכניות, הפסקת עבודה ודחיסת הקשר בחיבור חי לסוכני פיתוח.'],
  ['task_76b337bcfa7db953636318fb7dd755799ae72c04cfc7c53fc29c5cbf60b5b4df','Design scalable meaning-based routing across a large project history.','תכנן התמצאות לפי משמעות כשהיסטוריית הפרויקט גדולה מאוד.'],
  ['task_7d983f51fa4aa5ea423f209dd5f6142d8c577f80da9a7d4a42c86d1d044e2b40','Evaluate Laya pair classification in Hebrew and English before merging duplicate tasks.','בחן את סיווג זוגות המשימות של Laya בעברית ובאנגלית לפני איחוד כפילויות.'],
  ['task_8b4318ef-b13d-4420-988f-5266db4cd215','Compare permissive pretrained alternatives and custom tiny encoders for matching tasks.','השווה חלופות קוד פתוח ומודלי אחזור קטנים מותאמים למציאת משימות קיימות.'],
  ['task_8e2b3942-b639-48d4-a324-0bfd6f8a8e90','Improve separate-worktree handoffs so waiting agents refresh their merge base.','שפר העברת עבודה בין עצי עבודה כך שסוכן שהמתין ירענן את בסיס המיזוג.'],
  ['task_a12b530ef91361c8ff8527e0048dde3b5a6ef45fb2a96b39fb71057776392f1e','Coordinate ownership across independent clones on different machines, including offline cases.','תאם בעלות בין עותקים עצמאיים במחשבים שונים, גם כשחיבור הרשת נפסק.'],
  ['task_e0098db7-8a67-4363-bef0-509e0955d475','Measure long-term coding quality in natural project changes across multiple domains.','מדוד איכות פיתוח לאורך זמן מול שינויים טבעיים בפרויקטים מתחומים שונים.'],
  ['task_15793da9-9d59-4fa4-acbf-65e08b24907b','Preserve queued recordings for deleted temporary repositories and avoid endless retry errors.','שמור אירועים בתור של תיקיות זמניות שנמחקו והפסק שגיאות חוזרות ללא סוף.'],
  ['task_0fc443ee-b79b-4f6d-977f-e14c34a9df57','Keep work open when a partial test passes; require explicit full completion.','השאר עבודה פתוחה כשבדיקה חלקית עברה ודרוש סיום מפורש של כל הדרישות.'],
  ['task_fef5991042dd2c86eb047c1ac4db89f592beb1579913ffdbd3c5f19c0964030d','Profile cold and warm navigation over ten thousand ledger items and reduce capture cost.','מדוד התמצאות קרה וחמה בעשרת אלפים רשומות והפחת את עלות התיעוד.'],
  ['task_6c49493af99687df92ebdeacfee9581fe83d1373bba187a704dd98495495fbd7','Link a Markdown plan once using path, role and content hash, then retrieve relevant sections.','קשר תכנית Markdown פעם אחת לפי נתיב, תפקיד וגיבוב תוכן, ואז אחזר סעיפים רלוונטיים.'],
  ['task_946d6e12859ad5986645e9e0127add5a352aafb520417424c484f72982cd24be','Expose current criteria, component owners and changes since evidence through focused tools.','הצג דרך כלים ממוקדים דרישות תקפות, בעלי רכיבים ושינויים מאז ראיות הבדיקה.'],
  ['task_961a3099-11c8-49d1-98c9-6c422a347fc8','Make the dashboard readable and minimal with translucent glass and accessible keyboard behavior.','עצב דאשבורד קריא ומינימליסטי עם זכוכית שקופה חלקית ונגישות למקלדת.'],
  ['task_85cdc79ef6e2c7c38586d0cd563158c3e009d4efb6a1c8f5516fbe465ca3b87d','Audit unfinished requirements and add explicit outcomes while filtering discussion noise.','בדוק דרישות שנותרו פתוחות והוסף תוצאות מפורשות תוך סינון רעש משיחות.'],
  ['task_358d32ed-9c7b-453e-a23f-244f00ef174c','Recover the completed seven-model retrieval pilot with its frozen raw scores and costs.','מצא את ניסוי האחזור שהושלם על שבע חלופות, עם תוצאות גולמיות ועלויות שנשמרו.'],
];
export function sha(x) {return createHash('sha256').update(x).digest('hex');}
export function buildWinnerCorpus(git) {
  const repo=ensure(process.cwd());
  const head=execFileSync(git,['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const sources=[], queries=[]; const docPaths=new Set();
  for(const [id,en,he] of fixtures) {
    const task=taskRead(repo,id);
    const text=`# ${task.title}\n\n${task.description||''}\n\n## Current criteria\n${task.acceptance.map(x=>'- '+x).join('\n')}\n\n## Source references\n${(task.documents||[]).map(d=>d.path).join('\n')}`;
    const fields={title:task.title,description:task.description,acceptance:task.acceptance,scope:task.scope,status:task.status,resolution:task.resolution,documents:task.documents};
    sources.push({id,kind:'task',path:`.dip/events/${id}`,text,contentHash:sha(text),recordedStatus:task.status,verification:'not_checked',intentHash:sha(JSON.stringify(fields)),fields});
    for(const d of task.documents||[]) if(d.path.endsWith('.md'))docPaths.add(d.path);
    for(const [language,q] of [['en',en],['he',he]]) queries.push({id:`real-${id}-${language}`,suite:'real',language,q,gold:[id],kind:'task'});
  }
  for(const file of [...docPaths].sort()) {
    // Export only committed public project documents; never private runtime/log/auth data.
    const text=execFileSync(git,['show',`${head}:${file}`],{encoding:'utf8'}).replaceAll('\r\n','\n');
    sources.push({id:file,kind:'document',path:file,text,contentHash:sha(text),recordedStatus:null,verification:'not_checked'});
  }
  const docQueries=[
    ['docs/navigation.md','How does search differ from proving that two tasks are equivalent?','כיצד החיפוש שונה מהוכחה ששתי משימות הן אותה משימה?','Search and explicit relationships'],
    ['docs/navigation.md','Where is component ownership read from and does it synchronize between independent machines?','מאיפה נקראת בעלות על רכיב והאם היא מסתנכרנת בין מחשבים עצמאיים?','Ownership'],
    ['docs/operations.md','What happens to queued activity when a repository folder disappears?','מה קורה לאירועים שממתינים בתור כשהתיקייה של המאגר נעלמת?','Updates and recovery'],
    ['docs/completion.md','Can an ended agent turn or a passing partial test close a development requirement?','האם סיום תשובת סוכן או בדיקה חלקית שעברה מספיקים לסגירת דרישת פיתוח?','Explicit outcomes and compact reads'],
    ['docs/plans/markdown-references.md','What are the boundaries for executing instructions read from a linked plan?','מה הגבולות לביצוע הוראות שנקראות מתוך תכנית מקושרת?','Boundaries'],
    ['docs/benchmarks/semantic-retrieval-pilot.md','What were the Hebrew and cross-language candidate retrieval results of the encoders?','מה היו תוצאות אחזור המועמדים בעברית ובין השפות במודלי האחזור?','Finding candidates'],
  ];
  for(const [index,[path,en,he,heading]] of docQueries.entries())for(const [language,q] of [['en',en],['he',he]]) queries.push({id:`doc-${index}-${language}`,suite:'documents',language,q,gold:[path],kind:'document',goldHeading:heading});
  const unmatched=[['Add biometric attendance tracking for warehouse staff.','הוסף מעקב נוכחות ביומטרי לעובדי מחסן.'],['Predict tropical cyclone paths from satellite images.','חזה מסלולי סופות טרופיות מתמונות לוויין.'],['Calculate nutrition plans for endurance athletes.','חשב תפריטי תזונה לספורטאי סיבולת.'],['Implement a multiplayer chess tournament rating engine.','ממש מנוע דירוג לטורניר שחמט מרובה משתתפים.']];
  for(const [i,[en,he]] of unmatched.entries())for(const [language,q] of [['en',en],['he',he]])queries.push({id:`none-${i}-${language}`,suite:'real',language,q,gold:[],kind:'task'});
  const old=JSON.parse(fs.readFileSync('docs/benchmarks/2026-10-08-semantic-protocol.json'));
  const synthetic={};
  for(const language of ['en','he']) synthetic[language]=history(old.corpus.tasks[language],1000,language).map(t=>({id:t.id,kind:'task',path:`synthetic/${t.id}`,text:projectText(t),contentHash:sha(projectText(t)),recordedStatus:t.status,verification:'not_checked',version:t.version}));
  for(const query of old.corpus.queries.filter(q=>q.split==='test'&&q.scenario!=='misleading'))queries.push({id:`known-${query.id}`,suite:'known-synthetic',language:query.language,store:query.store,q:query.q,gold:query.gold?[query.gold]:[],kind:'task',version:query.version,known:true});
  const padding=Array.from({length:120},(_,i)=>`Legacy appendix entry ${i}: routine packaging notes, meeting reminders and discarded drafts are retained for audit. These notes do not authorize actions or prove work finished.`).join('\n')+'\n\n';
  // Move the actual requirements beyond both encoder windows without changing them.
  const late=sources.filter(s=>s.kind==='task').map(s=>({...s,text:padding+s.text,contentHash:sha(padding+s.text)}));
  for(const q of queries.filter(x=>x.suite==='real'))queries.push({...q,id:'late-'+q.id,suite:'late'});
  return {head,sources,late,synthetic,queries,sourceFiles:[...docPaths].sort()};
}
