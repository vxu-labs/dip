import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {score,fixture} from './semantic-agent-fixtures.mjs';
export function isolatedScore(root,index){
  try{
    const output=execFileSync(process.execPath,[fileURLToPath(import.meta.url),'--worker',root,String(index)],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024,windowsHide:true});
    return JSON.parse(output.trim().split('\n').at(-1));
  }catch(e){
    return {checks:fixture(index).checks({}).map(([name])=>({name,passed:false})),memory:['task identity','current version','future deferred','completion','unresolved','source citation'].map(name=>({name,passed:false})),error:'Scoring subprocess failed or exceeded30s',passed:0,total:8,memoryPassed:0,memoryTotal:6,allPassed:false,recovery:null};
  }
}
if(process.argv[2]==='--worker')console.log(JSON.stringify(await score(process.argv[3],Number(process.argv[4]))));
