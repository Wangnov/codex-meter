const {test} = require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const storage={};
const context=vm.createContext({window:{},Date,URL,chrome:{runtime:{sendMessage:async()=>({ok:true})},storage:{local:{
  get:async keys=>Object.fromEntries(keys.map(k=>[k,structuredClone(storage[k])])),
  set:async values=>Object.assign(storage,structuredClone(values)),remove:async keys=>keys.forEach(k=>delete storage[k]),
}}}});
for(const file of ['shared/config.js','domain/usage-domain.js','infrastructure/report-repository.js','application/report-service.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../codex-meter-extension',file),'utf8'),context);
const w=context.window;
test('optional analytics failure preserves base report and has explicit warning',async()=>{
  const paths=[];
  const service=w.CodexMeterReportService.createReportService({
    chatGptClient:{getBootstrapToken:()=> 'test',apiGet:async path=>{
      paths.push(path);
      if(path==='/backend-api/wham/usage')return {account_id:'a',user_id:'u',rate_limit:{}};
      if(path.includes('daily-workspace'))return {data:[{date:'2026-09-07',totals:{credits:10}}],balance_unit:'credit'};
      throw new Error('offline');
    }},config:w.CodexMeterConfig.CONFIG,domain:w.CodexMeterDomain,getPageLocale:()=> 'zh-CN',pageHref:()=> 'https://chatgpt.com/codex/cloud/settings/analytics',reportRepository:w.CodexMeterReportRepository,translate:k=>k,
  });
  const report=await service.refreshReport();
  assert.equal(report.totalStats.credits,10);
  assert.equal(report.historyWarnings.length,2);
  assert.equal(report.accountScope,'a:u');
  assert.ok(paths.some(p=>p.includes('workspace_user=true')));
  assert.equal((await w.CodexMeterReportRepository.load()).latest.historyWarnings.length,2);
});
test('global reset records are account scoped, fresh after cache hydration, and survive clearing snapshots',async()=>{
  const repo=w.CodexMeterReportRepository;
  await repo.saveGlobalResets('a:u',[{at:'2026-09-07T00:00:00Z'}]);
  await repo.saveGlobalResets('b:u',[{at:'2026-09-04T00:00:00Z'}]);
  assert.equal((await repo.load()).latest.globalResets.length,1);
  await repo.saveGlobalResets('a:u',[]);
  assert.equal((await repo.load()).latest.globalResets.length,0);
  assert.equal((await repo.loadGlobalResets('b:u')).length,1);
  await repo.clear();
  assert.equal((await repo.loadGlobalResets('b:u')).length,1);
  await assert.rejects(()=>repo.saveGlobalResets(null,[]));
});

test('storage quota failure returns fresh report without retrying or clearing history', async () => {
  let saves = 0;
  const service = w.CodexMeterReportService.createReportService({
    chatGptClient: { getBootstrapToken: () => 'test', apiGet: async path => {
      if (path === '/backend-api/wham/usage') return { account_id: 'a', user_id: 'u', rate_limit: {} };
      if (path.includes('daily-workspace')) return { data: [{ date: '2026-10-06', totals: { credits: 123 } }] };
      return {};
    } },
    config: w.CodexMeterConfig.CONFIG, domain: w.CodexMeterDomain,
    getPageLocale: () => 'zh-CN', pageHref: () => 'https://chatgpt.com/settings/usage?tab=analytics',
    reportRepository: { loadGlobalResets: async () => [], save: async () => {
      saves++; throw new Error('Resource::kQuotaBytes quota exceeded');
    } }, translate: k => k,
  });
  const report = await service.refreshReport();
  assert.equal(report.dailyList[0].date, '2026-10-06');
  assert.equal(report.totalStats.credits, 123);
  assert.ok(report.historyWarnings.includes('storageSaveFailed'));
  assert.equal(saves, 1);
});
