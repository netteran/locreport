const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const {NextRequest}=require('next/server')
const {PGlite}=require('@electric-sql/pglite')
const {load:htmlDocument}=require('cheerio')
const { load } = require('./fixtures/typescript.cjs')
const weekly=load('lib/email/weeklyNote.ts')
const editionCompany=load('lib/email/editionCompany.ts')
let generated=0
const generatedIssue={storyCount:1,articleIds:['article'],editorNote:'Opening',topStory:{id:'article',title:'A story',url:'https://locreport.com/analysis/story/',excerpt:'A useful summary.'},company:null,market:null,directory:[],facts:[{content:'A fact',url:'https://example.test/fact'}],more:[],moreCount:0}
const edition=load('lib/email/edition.ts',{
 './issue':{buildIssue:async()=>{generated++;return {issue:generatedIssue}}},
 './weeklyNote':weekly,'./send':{SITE_URL:'https://locreport.com'}
})
function db() {
 const rows=new Map();let failure=null
 const service={from(table){assert.equal(table,'weekly_newsletter_editions');let date
  const q={select(){return q},eq(k,v){date=v;return q},async maybeSingle(){return {data:rows.get(date)||null,error:failure}},async upsert(row){if(!failure) rows.set(row.edition_date,row);return {error:failure}}};return q}}
 return {service,rows,fail:e=>{failure=e}}
}
test('validates the full subject/body and creates content-specific edition revisions',()=>{
 const copy=edition.normalizeEdition({subject:' Edited subject ',body_markdown:' Body\r\n\r\n[Link](https://example.test) '})
 assert.equal(copy.subject,'Edited subject');assert.equal(copy.body_markdown,'Body\n\n[Link](https://example.test)')
 for(const input of [{subject:'',body_markdown:'x'},{subject:'x\nBcc:x',body_markdown:'x'},{subject:'a'.repeat(201),body_markdown:'x'},{subject:'x',body_markdown:''},{subject:'x',body_markdown:'x'.repeat(60001)}])assert.throws(()=>edition.normalizeEdition(input))
 const revision=edition.editionRevision(copy,'2026-11-20')
 assert.notEqual(revision,edition.editionRevision({...copy,body_markdown:'Another body'},'2026-11-20'))
 assert.notEqual(revision,edition.editionRevision(copy,'2026-11-27'))
 assert.match(edition.issueMarkdown(generatedIssue),/Opening[\s\S]*Top story[\s\S]*A story[\s\S]*Fact Flow/)
})
test('saved editions bypass changing live content, never leak into another week, and fail closed on DB errors',async()=>{
 const f=db(), date='2026-11-20', copy={edition_date:date,subject:'Edited',body_markdown:'Only reviewed copy',article_ids:[]}
 f.rows.set(date,copy);generated=0
 const result=await edition.resolveEdition(f.service,new Date('2026-11-10'),new Date('2026-11-18'))
 assert.equal(result.bodyMarkdown,copy.body_markdown);assert.equal(result.subject,'Edited');assert.equal(generated,0)
 const next=await edition.resolveEdition(f.service,new Date('2026-11-21'),new Date('2026-11-25'));assert.equal(next.bodyMarkdown,null);assert.equal(generated,1)
 f.fail({code:'42501',message:'permission denied'});await assert.rejects(edition.loadEdition(f.service,date,true),/permission denied/)
 f.fail({code:'42P01',message:'weekly_newsletter_editions does not exist'});assert.equal(await edition.loadEdition(f.service,date,true),null);await assert.rejects(edition.loadEdition(f.service,date),/20261124/)
 f.fail({code:'42P01',message:'other_table does not exist'});await assert.rejects(edition.loadEdition(f.service,date,true),/other_table/)
})
test('edition API authenticates, rejects stale weeks/conflicting edits and saves complete copy',async()=>{
 const f=db();let admin=false
 const api=load('app/api/digest/edition/route.ts',{'@/lib/adminAuth':{requireAdmin:async()=>admin?{}:null},'@/lib/supabase/server':{createServiceClient:()=>f.service},'@/lib/email/period':{currentPeriod:()=>({periodStart:new Date(),periodEnd:new Date()})},'@/lib/email/weeklyNote':weekly,'@/lib/email/issue':{buildIssue:async()=>({issue:generatedIssue})},'@/lib/email/edition':{...edition,linkedArticleIds:async()=>[]},'@/lib/email/editionCompany':editionCompany})
 const get=()=>api.GET(new NextRequest('http://localhost/api/digest/edition'))
 const put=body=>api.PUT(new NextRequest('http://localhost/api/digest/edition',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}))
 assert.equal((await get()).status,401);assert.equal((await put({})).status,401);admin=true
 const initial=await (await get()).json();assert.equal(initial.saved,false)
 const copy={editionDate:weekly.weeklyEditionDate(),subject:'My subject',body_markdown:'## Edited section\n\nFull copy and [link](https://example.test).',revision:null}
 assert.equal((await put({...copy,editionDate:'2020-01-03'})).status,409)
 const saved=await put(copy);assert.equal(saved.status,200)
 const data=await saved.json();assert.equal(data.saved,true);assert.ok(data.revision)
 assert.equal((await put({...copy,subject:'Stale overwrite'})).status,409)
 assert.equal((await (await get()).json()).body_markdown,copy.body_markdown)
 assert.equal((await put({...copy,revision:data.revision,subject:'Updated'})).status,200)
})
test('complete edition renderer supports sections, lists, quotes, images and safe links without executing HTML',()=>{
 const {editedDigestEmail}=load('lib/email/templates.ts')
 const html=editedDigestEmail({editionDate:'2026-11-20',manageUrl:'https://locreport.com/manage',bodyMarkdown:'## Edited\n\n- First with [list link](https://example.test/list)\n- Second\n  - Nested **point** and [nested link](https://example.test/nested)\n\n> A quotation\n\n[Good](https://example.test) [Bad](javascript:alert(1))\n\n<script>bad()</script>\n\n![Logo](https://example.test/logo.png)'})
 assert.match(html,/<ul/);assert.match(html,/<li/);assert.match(html,/<blockquote/);assert.match(html,/20 November 2026/);assert.match(html,/Manage subscription/);assert.match(html,/<img src="https:\/\/example.test\/logo.png"/)
 assert.doesNotMatch(html,/<script|href="javascript:/);assert.match(html,/&lt;script&gt;/)
 assert.match(html,/href="https:\/\/example.test\/list"[^>]*>list link<\/a>/);assert.match(html,/<strong>point<\/strong>/);assert.match(html,/href="https:\/\/example.test\/nested"/)
})
test('saving the assembled newsletter keeps the story hierarchy, company card and Fact Flow callouts',()=>{
 const issue=require('./fixtures/newsletter.cjs'),{editedDigestEmail}=load('lib/email/templates.ts')
 const markdown=edition.issueMarkdown(issue)
 const $=htmlDocument(editedDigestEmail({editionDate:'2026-11-20',manageUrl:'https://locreport.com/manage',bodyMarkdown:markdown}))
 assert.deepEqual($('[data-newsletter-section]').map((_,e)=>$(e).attr('data-newsletter-section')).get(),['story','company','facts','market','directory','more'])
 const story=$('[data-newsletter-section="story"]')
 assert.equal(story.find('h2 a').text(),issue.topStory.title)
 assert.equal(story.find('h2 a').attr('href'),issue.topStory.url)
 assert.match(story.find('h2').attr('style'),/font-size:30px/)
 assert.match(story.find('.newsletter-lead > p').first().attr('style'),/color:#80520F/)
 assert.match(story.find('a').last().attr('style'),/background:#3550F5/)
 assert.equal($('.newsletter-masthead h1').text(),'The Weekly')
 assert.equal(story.text().includes('Why it matters'),true)
 assert.equal(story.find('a').last().text(),'Read the story →')
 const company=$('[data-newsletter-section="company"]')
 assert.match(company.children('table').attr('style'),/background:#EDF9F4/)
 assert.equal(company.find('img').attr('width'),'56')
 assert.equal(company.find('a').first().text(),issue.company.name)
 for(const text of [issue.company.blurb,'est. 2015',issue.company.hq])assert.ok(company.text().includes(text))
 const facts=$('[data-newsletter-section="facts"] li')
 assert.equal(facts.length,issue.facts.length)
 facts.each((i,e)=>{assert.match($(e).attr('style'),/border-left:2px solid #3550F5/);assert.equal($(e).find('a').attr('href'),issue.facts[i].url)})
 for(const text of [issue.topStory.excerpt,...issue.topStory.business_implications,issue.directory[0].description,...issue.more.map(a=>a.title)])assert.ok($.text().includes(text),text)
 assert.ok($('[data-newsletter-section="directory"]').text().includes(issue.directory[0].category))
 const market=$('[data-newsletter-section="market"]')
 assert.match(market.find('span').filter((_,e)=>$(e).text()==='+9.2%').attr('style'),/color:#1E7F4F/)
 assert.match(market.find('span').filter((_,e)=>$(e).text()==='-8.1%').attr('style'),/color:#B3261E/)
 assert.equal($('a').filter((_,e)=>$(e).text()==='Manage subscription').attr('href'),'https://locreport.com/manage')
})
test('existing saved Markdown gains the layout without changing its text, destinations or adding removed links',()=>{
 const {editedDigestEmail}=load('lib/email/templates.ts')
 const markdown='Editor-owned opening.\n\n## Top story\n\n[An edited headline](https://example.test/edited)\n\nThe edited explanation.\n\n- An edited implication.\n\n## Company of the week\n\n[Chosen company](https://example.test/company)\n\nA company without a logo.\n\n## A renamed section\n\n> A carefully preserved quote.\n\n1. First decision.\n2. Second decision.'
 const $=htmlDocument(editedDigestEmail({editionDate:'2026-11-20',manageUrl:'https://locreport.com/manage',bodyMarkdown:markdown}))
 assert.equal($('[data-newsletter-section="story"] h2').text(),'An edited headline')
 assert.equal($('[data-newsletter-section="company"] img').length,0)
 assert.equal($('h2').filter((_,e)=>$(e).text()==='A renamed section').length,1)
 assert.equal($('blockquote').text().trim(),'A carefully preserved quote.')
 assert.equal($('ol li').length,2)
 assert.deepEqual($('.newsletter-content a').map((_,e)=>$(e).attr('href')).get(),['https://example.test/edited','https://example.test/company'])
 assert.doesNotMatch($.text(),/Read the story|See the profile/)
 assert.ok($.text().includes('The edited explanation.'))
})
test('section cards keep source HTML, unsafe images and credential-bearing URLs inert',()=>{
 const {editedDigestEmail}=load('lib/email/templates.ts')
 const $=htmlDocument(editedDigestEmail({editionDate:'2026-11-20',manageUrl:'https://locreport.com/manage',bodyMarkdown:'## Company of the week\n\n[Company](https://user:password@example.test)\n\n![Logo](javascript:alert(1))\n\n<img src=x onerror=alert(1)>\n\n## Fact Flow\n\n- [Unsafe](data:text/html,test)\n- Safe **copy**.'}))
 assert.equal($('.newsletter-content img,.newsletter-content script').length,0)
 assert.deepEqual($('.newsletter-content a').map((_,e)=>$(e).attr('href')).get(),['https://locreport.com/fact-flow'])
 assert.match($.text(),/<img src=x onerror=alert\(1\)>/)
 assert.ok($.text().includes('Safe copy.'))
})
test('edition table is private and rejects non-Friday or empty content in PostgreSQL',async()=>{
 const db=new PGlite();try {
 await db.exec('create role anon; create role authenticated; create role service_role;')
 await db.exec(fs.readFileSync('supabase/migrations/20261124_weekly_newsletter_editions.sql','utf8'))
 for(const role of ['anon','authenticated']) assert.equal((await db.query(`select has_table_privilege('${role}','public.weekly_newsletter_editions','SELECT') allowed`)).rows[0].allowed,false)
 assert.equal((await db.query("select relrowsecurity from pg_class where relname='weekly_newsletter_editions'")).rows[0].relrowsecurity,true)
 await db.exec("insert into weekly_newsletter_editions values ('2026-11-20','Subject','Body','{}',now())")
 await assert.rejects(db.exec("insert into weekly_newsletter_editions values ('2026-11-19','Subject','Body','{}',now())"),/check constraint/)
 await assert.rejects(db.exec("update weekly_newsletter_editions set body_markdown=''"),/check constraint/)
 await db.exec(fs.readFileSync('supabase/migrations/20261129_weekly_newsletter_web_editions.sql','utf8'))
 for(const role of ['anon','authenticated']) {
   assert.equal((await db.query(`select has_table_privilege('${role}','public.weekly_newsletter_web_editions','SELECT') allowed`)).rows[0].allowed,false)
 }
 await db.exec("insert into weekly_newsletter_web_editions(id, edition_date, html) values(repeat('a',64), '2026-11-20', 'Public copy')")
 await assert.rejects(db.exec("insert into weekly_newsletter_web_editions(id, edition_date, html) values('invalid', '2026-11-20', 'Public copy')"),/check constraint/)
 }finally{await db.close()}
})

test('preview and manual/cron sends use the same saved subject/body and reject a stale revision before delivery',async()=>{
 const templates=load('lib/email/templates.ts'), sent=[], snapshots=[], archive=new Map()
 process.env.ADMIN_EMAIL='editor@example.test';process.env.CRON_SECRET='fixture-cron'
 const resolved={editionDate:'2026-11-20',subject:'Reviewed subject',bodyMarkdown:'## Reviewed edition\n\nComplete edited copy and [link](https://example.test).',revision:'reviewed-v1',issue:{storyCount:0,articleIds:[]}}
 const service={from(table){
   let id
   const q={
     select(){return q},eq(_,value){id=value;return q},update(){return q},
     insert:async value=>{snapshots.push(value);return {error:null}},
     upsert:async (value, options)=>{
       assert.equal(table,'weekly_newsletter_web_editions')
       assert.equal(options.ignoreDuplicates,true)
       archive.set(value.id,value)
       return {error:null}
     },
     maybeSingle:async ()=>{
       assert.equal(table,'weekly_newsletter_web_editions')
       return {data:archive.get(id),error:null}
     },
     then(resolve,reject){return Promise.resolve({data:table==='subscribers'?[{id:'90000000-0000-4000-8000-000000000001',email:'reader@example.test',manage_token:'token',last_sent_at:null}]:[],error:null}).then(resolve,reject)}
   }
   return q
 }}
 const dependencies={'@/lib/supabase/server':{createClient:async()=>({auth:{getUser:async()=>({data:{user:{email:'editor@example.test'}}})}}),createServiceClient:()=>service},'@/lib/email/templates':templates,'@/lib/email/send':{SITE_URL:'https://locreport.com',digestFrom:()=> 'editor@example.test',getResend:()=>({batch:{send:async batch=>{sent.push(...batch);return {data:{data:[{id:'fixture-send'}]},error:null}}}})},'@/lib/email/period':{currentPeriod:()=>({periodStart:new Date('2026-11-13'),periodEnd:new Date('2026-11-20'),periodLabel:'Test period'})},'@/lib/email/edition':{resolveEdition:async()=>resolved}}
 const preview=load('app/api/digest/preview/route.ts',dependencies), send=load('app/api/digest/send/route.ts',dependencies)
 assert.equal((await send.POST(new NextRequest('http://localhost/api/digest/send?revision=old',{method:'POST'}))).status,409)
 assert.equal((await preview.GET(new NextRequest('http://localhost/api/digest/preview?revision=old'))).status,409)
 assert.equal(sent.length,0)
 const html=await (await preview.GET(new NextRequest('http://localhost/api/digest/preview?revision=reviewed-v1'))).text()
 const previewDoc=htmlDocument(html)
 const previewLink=previewDoc('a').filter((_,element)=>previewDoc(element).text()==='View in browser').attr('href')
 assert.equal(previewLink,'/api/digest/preview?browser=1&revision=reviewed-v1')
 const browserPreview=await preview.GET(new NextRequest(new URL(previewLink,'http://localhost')))
 assert.equal(browserPreview.status,200)
 assert.equal(browserPreview.headers.get('Cache-Control'),'private, no-store')
 const previewHtml=await browserPreview.text()
 assert.equal(htmlDocument(previewHtml)('.newsletter-content').html(),previewDoc('.newsletter-content').html())
 assert.doesNotMatch(previewHtml,/token=|Manage subscription|View in browser/)
 assert.equal(archive.size,0)
 assert.equal((await preview.GET(new NextRequest('http://localhost/api/digest/preview?browser=1&revision=old'))).status,409)
 const dry=await send.POST(new NextRequest('http://localhost/api/digest/send?dry=1&revision=reviewed-v1',{method:'POST'}))
 assert.equal((await dry.json()).recipients,1);assert.equal(sent.length,0);assert.equal(archive.size,0)
 assert.equal((await send.POST(new NextRequest('http://localhost/api/digest/send?revision=reviewed-v1',{method:'POST'}))).status,200)
 assert.equal(sent[0].subject,'Reviewed subject')
 const markup=htmlDocument(sent[0].html)
 assert.equal(markup('.newsletter-content').html(),htmlDocument(html)('.newsletter-content').html())
 assert.equal(markup('.newsletter-footer a').attr('href'),'https://locreport.com/subscribe/manage?token=token')
 const link=markup('a').filter((_,element)=>markup(element).text()==='View in browser').attr('href')
 assert.match(link,/^https:\/\/locreport\.com\/the-weekly\/[a-f0-9]{64}$/)
 const id=new URL(link).pathname.split('/').pop()
 const browser=load('app/the-weekly/[id]/route.ts',dependencies)
 const web=await browser.GET(new Request(link),{params:Promise.resolve({id})})
 assert.equal(web.status,200)
 assert.equal(web.headers.get('X-Robots-Tag'),'noindex')
 const publicHtml=await web.text()
 const publicDoc=htmlDocument(publicHtml)
 assert.equal(publicDoc('.newsletter-content').html(),markup('.newsletter-content').html())
 assert.doesNotMatch(publicHtml,/token=|reader@example\.test|Manage subscription|View in browser/)
 assert.equal((await browser.GET(new Request(link),{params:Promise.resolve({id:'wrong'})})).status,404)
 assert.equal(snapshots[0].html,sent[0].html);assert.match(sent[0].html,/Complete edited copy/)
 assert.equal((await send.POST(new NextRequest('http://localhost/api/digest/send',{method:'POST',headers:{Authorization:'Bearer fixture-cron'}}))).status,200)
 assert.equal(sent[1].html,sent[0].html)
 assert.equal(archive.size,1)
 resolved.bodyMarkdown='## Revised edition\n\nA later version.'
 assert.equal((await send.POST(new NextRequest('http://localhost/api/digest/send',{method:'POST',headers:{Authorization:'Bearer fixture-cron'}}))).status,200)
 assert.equal(archive.size,2)
 assert.equal(await (await browser.GET(new Request(link),{params:Promise.resolve({id})})).text(), publicHtml)
})

test('Fact Flow shows an accurate weekly count and links to the full feed', () => {
  const { digestEmail, editedDigestEmail } = load('lib/email/templates.ts')
  const facts = Array.from({ length: 5 }, (_, i) => ({ content: 'Update ' + (i + 1), url: 'https://locreport.com/fact-flow#' + i }))
  const issue = { ...generatedIssue, facts, editorNote: '' }
  const automatic = digestEmail({ ...issue, periodLabel: '13–20 November 2026' })
  const saved = editedDigestEmail({ editionDate: '2026-11-20', bodyMarkdown: edition.issueMarkdown(issue) })
  for (const html of [automatic, saved]) {
    const $ = htmlDocument(html)
    const section = $('[data-newsletter-section="facts"]')
    assert.match(section.text(), /The week in 5 facts/)
    assert.equal(section.find('li').length, 5)
    assert.equal(section.find('a').last().attr('href'), 'https://locreport.com/fact-flow')
  }
  const existingCopy = '## Fact Flow\n\n- [One update](https://locreport.com/fact-flow#one)'
  assert.match(editedDigestEmail({ editionDate: '2026-11-20', bodyMarkdown: existingCopy }), /One update from this week/)
  const fewerFacts = digestEmail({ ...issue, facts: facts.slice(0, 2), periodLabel: '13–20 November 2026' })
  assert.match(fewerFacts, /The week in 2 facts/)
})
