import test from 'node:test';
import assert from 'node:assert/strict';
import {resolvePiExtensionInvocation} from './invocation.js';
const extensions=[{id:'lcu',name:'lcu-computer-use'},{id:'other',name:'Other Extension'}];
test('explicit installed extension requests bind the native entry before model tool choice',()=>{
 for(const text of ['使用 LCU 查看窗口','请用 lcu 截图','Use LCU to inspect the window','@pi/lcu capture the window']) assert.equal(resolvePiExtensionInvocation(text,extensions)?.id,'lcu');
 for(const text of ['安装 LCU','LCU 是什么？','Do not use LCU','不要使用 LCU','使用 lcu-other 截图','分析一下“使用 LCU 截图”这段文字','使用 LCU 为什么截图空白？']) assert.equal(resolvePiExtensionInvocation(text,extensions),null,text);
 assert.equal(resolvePiExtensionInvocation('Use LCU',[]),null);
 assert.throws(()=>resolvePiExtensionInvocation('@pi/missing capture',extensions),/unavailable or disabled/);
 assert.throws(()=>resolvePiExtensionInvocation('@pi/lcu capture',[]),/unavailable or disabled/);
});
