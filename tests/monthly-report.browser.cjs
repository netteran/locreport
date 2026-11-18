// Run against the isolated app/fixture described in docs/research-workflow.md.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000'

;(async () => {
  const browser = await chromium.launch({
    headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
    await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
    const now = Math.floor(Date.now() / 1000)
    const user = { id: '90000000-0000-4000-8000-000000000001', email: 'editor@example.test', aud: 'authenticated', role: 'authenticated' }
    const token = [
      Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({ sub: user.id, email: user.email, aud: user.aud, role: user.role, iat: now, exp: now + 3600 })).toString('base64url'),
      'fixture'
    ].join('.')
    await context.addCookies([{
      name: 'sb-127-auth-token', url: base,
      value: 'base64-' + Buffer.from(JSON.stringify({ access_token: token, refresh_token: 'fixture-refresh', expires_at: now + 3600, expires_in: 3600, token_type: 'bearer', user })).toString('base64url')
    }])
    fs.mkdirSync('work/admin-preview', {recursive:true})
    const page = await context.newPage()
    page.setDefaultTimeout(30000)

    const errors=[], approvals=[], generations=[], saves=[];
    page.on('pageerror',e=>errors.push(e.message));
    const evidenceUrl='https://publisher.example/pricing';
    let draft={id:'monthly-test',title:'October briefing',slug:'2026-10-briefing',article_type:'monthly-summary',monthly_period:'2026-10',
      content:'# October briefing\n\nA buyer question arises ([source](https://publisher.example/pricing)).',status:'pending',
      source_url:null,created_at:'2026-11-16T10:00:00Z',extracted_facts:JSON.stringify({allowed_urls:[evidenceUrl],context:{source_evidence:[
        {title:'Pricing announcement',source_url:evidenceUrl,source_name:'Publisher',extracted_facts:'The supplier changed its prices.',quality:'snippet'}
      ]}})};
    await page.route('**/api/stats',r=>r.fulfill({json:{articles:10,drafts:1,sources:5}}));
    await page.route('**/api/monthly-report',r=>{generations.push(r.request().postDataJSON());return r.fulfill({json:{ok:true,status:'pending',draft_id:draft.id,title:draft.title,article_count:1,fact_count:2,source_count:3}})});
    await page.route('**/api/drafts',r=>r.fulfill({json:[draft]}));
    await page.route('**/api/drafts/monthly-test',r=>{
      if(r.request().method()==='PATCH'){
        const body=r.request().postDataJSON();
        assert.ok(!Object.hasOwn(body,'fact'),'monthly review must not submit a new Fact Flow headline');
        if(body.status==='approved')approvals.push(body);
        else saves.push(body);
        draft={...draft,...body};
      }
      return r.fulfill({json:{...draft,fact:null}});
    });
    await page.goto(base+'/admin/monthly',{timeout:120000});
    const row=page.locator('.admin-action').filter({has:page.getByRole('button',{name:'Generate monthly briefing',exact:true})});
    await row.getByLabel('Briefing start date').fill('2026-11-01');
    await row.getByLabel('Briefing end date').fill('2026-11-15');
    await row.getByRole('button',{name:'Run',exact:true}).click();
    await row.getByRole('button',{name:'Confirm',exact:true}).click();
    const review=page.getByRole('link',{name:'Review monthly briefing draft →'});await review.waitFor();
    assert.equal(generations.length,1);assert.equal(approvals.length,0);
    assert.deepEqual(generations[0],{force:false,start_date:'2026-11-01',end_date:'2026-11-15'});
    await review.click();
    await page.getByLabel('Title',{exact:true}).waitFor();
    assert.equal(await page.getByRole('navigation',{name:'Admin areas',exact:true}).getByRole('link',{name:'Monthly brief',exact:true}).getAttribute('aria-current'),'page');
    assert.equal(await page.getByRole('button',{name:'Re-run',exact:true}).count(),0);
    await page.getByText('Sources assessed for this briefing',{exact:true}).click();
    await page.getByRole('link',{name:'Pricing announcement',exact:true}).waitFor();
    const citationNote=page.getByRole('note').filter({hasText:'unclear text'});
    await citationNote.waitFor();
    assert.match(await citationNote.textContent(),/publisher, report name or relevant words/);
    await page.getByLabel('Title',{exact:true}).fill('Reviewed October briefing');
    const reviewed='The [pricing announcement](https://publisher.example/pricing) raises a buyer question.';
    await page.locator('textarea').first().fill(reviewed);
    await citationNote.waitFor({state:'detached'});
    await page.getByRole('button',{name:/^preview$/i}).click();
    const preview=page.locator('.prose');
    const link=preview.getByRole('link',{name:'pricing announcement',exact:true});
    assert.equal(await link.getAttribute('href'),evidenceUrl);
    assert.equal(await link.evaluate(a=>a.parentElement.tagName),'P');
    assert.equal(await preview.locator('p').textContent(),'The pricing announcement raises a buyer question.');
    await page.getByRole('button',{name:'Save draft',exact:true}).click();
    await page.getByRole('button',{name:'Save draft',exact:true}).waitFor({state:'visible'});
    assert.equal(approvals.length,0);
    assert.equal(saves.length,1);assert.equal(saves[0].content,reviewed);
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await page.waitForFunction(()=>window.scrollY===0);
    await page.screenshot({path:'work/admin-preview/monthly-draft-review.png',fullPage:true});
    await page.getByRole('button',{name:'Approve & publish',exact:true}).click();
    await page.waitForURL(base+'/admin/monthly');
    assert.equal(approvals.length,1);assert.equal(approvals[0].title,'Reviewed October briefing');
    assert.equal(approvals[0].content,reviewed);

    // The common ArticleEditor also guides manual edits to existing articles and briefings.
    for(const article_type of ['industry','monthly-summary']){
      let article={id:'citation-test',title:'Existing publication',slug:'citation-test',article_type,
        content:'The costs changed ([source](https://publisher.example/pricing)).'};
      const updates=[];
      await page.route('**/api/articles/citation-test',route=>{
        if(route.request().method()==='PATCH'){
          const body=route.request().postDataJSON();updates.push(body);article={...article,...body};
        }
        return route.fulfill({json:article});
      });
      await page.goto(base+'/admin/articles/citation-test');
      await page.locator('textarea').waitFor();
      await citationNote.waitFor();
      assert.equal(updates.length,0,'existing publications must not be rewritten on open');
      await page.locator('textarea').fill(reviewed);
      await citationNote.waitFor({state:'detached'});
      await page.getByRole('button',{name:/^preview$/i}).click();
      assert.equal(await page.locator('.prose a').getAttribute('href'),evidenceUrl);
      await page.getByRole('button',{name:'Publish now',exact:true}).click();
      await page.getByText('Saved.',{exact:true}).waitFor();
      assert.equal(updates.length,1);assert.equal(updates[0].content,reviewed);
      await page.unroute('**/api/articles/citation-test');
    }
    assert.deepEqual(errors,[]);
    console.log('Monthly briefing review and explicit approval plus natural-link guidance, preview and saved wording in article/briefing editors verified; all writes intercepted.');
  } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)})
