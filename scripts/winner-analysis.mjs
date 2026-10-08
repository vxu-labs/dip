export function winnerScore(data,protocol) {
  if(!data.completedAt||data.error||data.resourceAbort)return {model:data.model,complete:false,error:data.error||data.resourceAbort};
  const queries=new Map(protocol.corpus.queries.map(q=>[q.id,q]));
  const scores=[];
  for(const suite of ['real','late','documents','known-synthetic'])for(const strategy of data.strategies)for(const language of ['all','en','he','cross']) {
    const rows=data.rows.filter(r=>r.suite===suite&&r.strategy===strategy&&(language==='all'||queries.get(r.query).language===language));
    if(!rows.length)continue;
    const matching=rows.filter(r=>queries.get(r.query).gold.length),unmatched=rows.length-matching.length;
    const ranking=field=>{
      const ranks=matching.map(r=>{const gold=queries.get(r.query).gold;const index=r[field].findIndex(x=>gold.includes(x.id));return index<0?null:index+1;});
      return {r1:ranks.filter(x=>x===1).length,r5:ranks.filter(x=>x&&x<=5).length,r10:ranks.filter(Boolean).length,mrr10:matching.length?ranks.reduce((s,r)=>s+(r?1/r:0),0)/matching.length:null};
    };
    scores.push({suite,strategy,language,items:rows.length,matching:matching.length,unmatched,raw:ranking('raw'),eligible:ranking('eligible'),heading1:suite==='documents'?matching.filter(r=>queries.get(r.query).gold.includes(r.raw[0]?.id)&&queries.get(r.query).goldHeading===r.raw[0]?.heading).length:null,staleTop1:rows.filter(r=>['cancelled','superseded'].includes(r.raw[0]?.recordedStatus)).length,unmatchedWithCandidates:rows.filter(r=>!queries.get(r.query).gold.length&&r.eligible.length).length,medianSearchMs:median(rows.map(r=>r.searchSeconds*1000))});
  }
  return {model:data.model,complete:true,scores,indexes:data.indexes,cacheChecks:data.cacheChecks,resources:data.resources,readOnly:data.rows.every(r=>r.identityEstablished===false&&r.verification==='not_checked'&&r.decision==='candidate_only')};
}
export function median(values){const x=[...values].sort((a,b)=>a-b);return x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2;}
