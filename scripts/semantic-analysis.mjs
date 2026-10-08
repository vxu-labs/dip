export function fitThreshold(examples) {
  const candidates=[...new Set([...examples.map(x=>x.score), Math.max(...examples.map(x=>x.score))+1e-6])];
  const positives=examples.filter(x=>x.identity).length, negatives=examples.length-positives;
  const feasible=candidates.map(threshold=>{
    const tp=examples.filter(x=>x.identity&&x.score>=threshold).length;
    const fp=examples.filter(x=>!x.identity&&x.score>=threshold).length;
    return {threshold,tp,fp,positives,negatives};
  }).filter(x=>x.fp<=Math.floor(negatives*.05));
  return feasible.sort((a,b)=>b.tp-a.tp||a.fp-b.fp||b.threshold-a.threshold)[0];
}
export function classify(rows, threshold) {
  const tp=rows.filter(x=>x.identity&&x.score>=threshold).length, fp=rows.filter(x=>!x.identity&&x.score>=threshold).length;
  const positives=rows.filter(x=>x.identity).length, negatives=rows.length-positives;
  return {items:rows.length,tp,fp,fn:positives-tp,tn:negatives-fp,precision:tp+fp?tp/(tp+fp):null,recall:positives?tp/positives:null,accuracy:(tp+negatives-fp)/rows.length};
}
export function scoreResult(data, protocol) {
  if(!data.completedAt||data.error||data.resourceAbort) return {model:data.model,complete:false,error:data.error||data.resourceAbort};
  const pairLabels=new Map(protocol.corpus.pairs.map(p=>[p.id,p]));
  const pairs=data.pairs.map(p=>({...p,...pairLabels.get(p.id)}));
  const identity=pairs.length?fitThreshold(pairs.filter(x=>x.split==='calibration')):null;
  const legacyLabels=new Map(protocol.layaExploratory.map(x=>[x.id,x]));
  const queries=new Map(protocol.corpus.queries.map(q=>[q.id,q]));
  const rows=data.rows.map(r=>({...r,item:queries.get(r.query)}));
  const thresholds={};
  for(const mode of protocol.modes) {
    const cal=rows.filter(x=>x.size===100&&x.mode===mode&&x.item.split==='calibration');
    // Wrong top-1 matching suggestions count as false links as well as no-match suggestions.
    thresholds[mode]=fitThreshold(cal.map(x=>({score:x.eligible[0]?.[1]??-1,identity:!!x.item.gold&&x.eligible[0]?.[0]===x.item.gold})));
  }
  const retrieval=[];
  for(const size of protocol.sizes) for(const mode of protocol.modes) for(const language of ['all','en','he','cross']) for(const scenario of ['all','faithful','misleading','no-match']) {
    const slice=rows.filter(x=>x.size===size&&x.mode===mode&&x.item.split==='test'&&(language==='all'||x.item.language===language)&&(scenario==='all'||x.item.scenario===scenario));
    if(!slice.length) continue;
    const matching=slice.filter(x=>x.item.gold), noMatch=slice.filter(x=>!x.item.gold);
    const rank=(x,key)=>{const i=x[key].findIndex(([id])=>id===x.item.gold);return i<0?null:i+1;};
    const ranking=key=>({recall1:matching.filter(x=>rank(x,key)===1).length,recall5:matching.filter(x=>rank(x,key)&&rank(x,key)<=5).length,recall10:matching.filter(x=>rank(x,key)).length,mrr10:matching.length?matching.reduce((s,x)=>s+(rank(x,key)?1/rank(x,key):0),0)/matching.length:null});
    const suggestions=slice.filter(x=>x.eligible[0]?.[1]>=thresholds[mode].threshold);
    retrieval.push({size,mode,language,scenario,items:slice.length,matching:matching.length,noMatch:noMatch.length,raw:ranking('raw'),eligible:ranking('eligible'),links:suggestions.length,correctLinks:suggestions.filter(x=>x.item.gold&&x.eligible[0][0]===x.item.gold).length,falseLinks:suggestions.filter(x=>x.eligible[0][0]!==x.item.gold).length,noMatchFalseLinks:noMatch.filter(x=>x.eligible[0]?.[1]>=thresholds[mode].threshold).length,rawStaleTop1:slice.filter(x=>x.raw[0]?.[0].endsWith('-old')).length,medianSearchMs:median(slice.map(x=>x.searchSeconds*1000))});
  }
  return {model:data.model,complete:true,identity:identity?{calibration:identity,test:classify(pairs.filter(x=>x.split==='test'),identity.threshold),byLanguage:Object.fromEntries(['en','he','cross'].map(language=>[language,classify(pairs.filter(x=>x.split==='test'&&x.language===language),identity.threshold)])),legacy:classify(data.legacyPairs.map(x=>({...x,identity:legacyLabels.get(x.id).identity})),identity.threshold)}:null,thresholds,retrieval,resources:{parameters:data.parameterCount,embeddingTableParameters:data.embeddingTableParameters,weightBytes:data.weightBytes,peakRssBytes:data.peakRssBytes,loadSeconds:data.loadSeconds,downloadAndCacheLookupSeconds:data.downloadAndCacheLookupSeconds,queryBatchEncodeSeconds:data.queryBatchEncodeSeconds,warmQueryMedianMs:data.warmQueryEncodeSeconds?median(data.warmQueryEncodeSeconds)*1000:null,stores:data.stores,tokenCounts:data.tokenCounts}};
}
export function median(values) {const x=[...values].sort((a,b)=>a-b);return x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2;}
