import {execFileSync} from 'node:child_process';
for(const argv of [['--test','test/winner-analysis.test.js'],['scripts/winner-evidence.mjs']])execFileSync(process.execPath,argv,{stdio:'inherit',windowsHide:true});
