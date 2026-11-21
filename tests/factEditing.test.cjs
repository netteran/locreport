const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
const {NextRequest}=require('next/server')
const { load } = require('./fixtures/typescript.cjs')
function fixture() {
 let admin=true, readError=null, links=[];const writes=[]
 const current={source_url:'https://publisher.test/original',article_id:null,published_at:'2026-11-17T10:00:00Z',status:'published'}
 const service={from(table){let patch=null;const q={select(){return q},eq(){return patch?Promise.resolve({error:null}):q},single:async()=>({data:{...current},error:readError}),limit:async()=>({data:links,error:null}),update(v){patch=v;writes.push(v);return q},upsert:async()=>({error:null}),delete(){return q}};return q}}
 const api=load('app/api/facts/[id]/route.ts',{'@/lib/adminAuth':{requireAdmin:async()=>admin?{}:null,requireResearchSchema:async()=>null},'@/lib/supabase/server':{createServiceClient:()=>service},'@/lib/revalidate':{revalidateFactSurfaces(){}}})
 return {current,writes,admin:v=>admin=v,error:v=>readError=v,links:v=>links=v,patch:body=>api.PATCH(new NextRequest('http://localhost/api/facts/fact',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),{params:Promise.resolve({id:'fact'})})}
}
test('fact editor authenticates and validates original source links without altering unrelated fields',async()=>{
 const f=fixture();f.admin(false);assert.equal((await f.patch({source_url:'https://new.test'})).status,401);f.admin(true)
 for(const source_url of ['javascript:alert(1)','file:///secret','https://user:password@example.test',42])assert.equal((await f.patch({source_url})).status,400)
 assert.equal((await f.patch({content:''})).status,400)
 assert.equal(f.writes.length,0)
 assert.equal((await f.patch({source_url:'https://new.test/path',content:' Updated content '})).status,200)
 assert.deepEqual(f.writes[0],{source_url:'https://new.test/path',content:'Updated content'})
})
test('publishing uses the effective new source and never leaves a published fact without a usable destination',async()=>{
 const f=fixture();assert.equal((await f.patch({source_url:null})).status,400)
 f.current.source_url=null;f.current.status='pending'
 assert.equal((await f.patch({source_url:'https://publisher.test/new',status:'published'})).status,200)
 assert.equal(f.writes[0].status,'published');assert.equal(f.writes[0].published_at,f.current.published_at)
 f.current.status='published';f.links([{article_id:'article'}]);assert.equal((await f.patch({source_url:null})).status,200)
 f.error({code:'42501',message:'permission denied'});assert.equal((await f.patch({content:'A change'})).status,500)
})
test('a published analysis becomes the fact main link while original attribution stays available',()=>{
 const {factMainLink}=load('lib/publicFacts.ts',{'@/lib/researchSchema':{}})
 const fact={source_url:'https://publisher.test/original',analyses:[{slug:'2026/11/17/analysis'}]}
 assert.deepEqual(factMainLink(fact),{href:'/analysis/analysis/',external:false});assert.equal(fact.source_url,'https://publisher.test/original')
 assert.deepEqual(factMainLink({...fact,analyses:[]}),{href:'https://publisher.test/original',external:true})
 assert.equal(factMainLink({analyses:[],source_url:'javascript:alert(1)'}),null)
})
