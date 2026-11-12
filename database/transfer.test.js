'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {digest,normalized}=require('./transfer-sqlserver');
test('搬迁校验兼容 jsonb 键顺序与 date 驱动类型，检测图片、哈希及实际内容改变',()=>{
 const columns=[{name:'id',type:'int'},{name:'payload',type:'nvarchar'},{name:'day',type:'date'},
  {name:'salt',type:'binary'},{name:'created_at',type:'datetime2'}];
 const source={id:1,payload:'{"中文":"会员","b":[2,1]}',day:new Date('2026-11-12T00:00:00Z'),salt:Buffer.from([1,2,3]),created_at:new Date('2026-11-12T08:00:00Z')};
 const pg={...source,payload:'{"b":[2,1],"中文":"会员"}',day:'2026-11-12'};
 assert.equal(digest([source],columns),digest([pg],columns));
 assert.notEqual(digest([source],columns),digest([{...pg,salt:Buffer.from([1,2,4])}],columns));
 assert.notEqual(digest([source],columns),digest([{...pg,payload:'{"中文":"其他","b":[2,1]}'}],columns));
 assert.equal(normalized(source,columns).day,'2026-11-12');
});
