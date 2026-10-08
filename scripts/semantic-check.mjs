import {execFileSync} from 'node:child_process';
for(const argv of [['--test','test/semantic-analysis.test.js'],['scripts/semantic-evidence.mjs']]) execFileSync(process.execPath,argv,{stdio:'inherit',windowsHide:true});
