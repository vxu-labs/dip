import {execFileSync} from 'node:child_process';
execFileSync(process.execPath,['--test','test/semantic-prototype.test.js','test/semantic-agent.test.js'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/semantic-agent-evidence.mjs'],{stdio:'inherit'});
