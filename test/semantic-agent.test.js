import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,memory,taskText} from '../scripts/semantic-agent-fixtures.mjs';
test('new agent fixtures retain conflicting versions and deferred requirements across languages',()=>{
  for(let i=0;i<6;i++){
    const f=fixture(i),mate=fixture((i+3)%6);
    assert.equal(f.checks({}).length,8);
    assert.deepEqual(f.task,mate.task);
    assert.equal(memory(i).tasks.length,61);
    assert.match(f.document,/Historical design v1/);
    assert.match(f.document,/Current contract v2/);
    assert.match(taskText(f.task),new RegExp(f.task.future));
    assert.equal(memory(i).tasks.filter(t=>t.scope.includes('lib.mjs')).length,1);
  }
});
