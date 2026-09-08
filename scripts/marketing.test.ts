import test from "node:test";
import assert from "node:assert/strict";
import { content, defaultContent, eligible, email, matches, phone, render, safeUrl, segment } from "../lib/marketing/rules";
test("suppression always overrides subscribed status",()=>{
  assert.equal(eligible({status:"SUBSCRIBED",suppressed:true}),false);
  assert.equal(eligible({status:"SUBSCRIBED",suppressed:false}),true);
  assert.equal(eligible({status:"NEVER_SUBSCRIBED",suppressed:false}),false);
  assert.equal(eligible(null),false);
});
test("audited mailable segment has exact 365-day boundary and rejects future opens",()=>{
  const now=new Date("2026-09-07T12:00:00Z"), boundary=new Date(+now-365*86400000);
  const p={tags:[],lists:[],lastOpenedAt:boundary,lastOrderAt:null};
  assert.equal(matches(p,{openedDays:365},now),true);
  assert.equal(matches({...p,lastOpenedAt:new Date(+boundary-1)},{openedDays:365},now),false);
  assert.equal(matches({...p,lastOpenedAt:null},{openedDays:365},now),false);
  assert.equal(matches({...p,lastOpenedAt:new Date(+now+1)},{openedDays:365},now),false);
});
test("audiences intersect list/tag filters and exclude recent purchases",()=>{
  const now=new Date(),p={tags:["b2b"],lists:["VIP"],lastOpenedAt:now,lastOrderAt:now};
  assert.equal(matches(p,{tag:"b2b",list:"VIP"},now),true);
  assert.equal(matches(p,{tag:"b2b",excludePurchasedDays:7},now),false);
  assert.equal(matches({...p,lastOrderAt:null},{excludePurchasedDays:7},now),true);
});
test("normalization preserves phone country codes and rejects malformed identities",()=>{
  assert.equal(email(" Person@Example.com "),"person@example.com");
  assert.equal(phone("+1 (555) 123-4567"),"+15551234567");
  assert.throws(()=>phone("5551234567"));assert.throws(()=>email("x\n@example.com"));
});
test("templates escape hostile content and reject unsafe link schemes",()=>{
  const html=render({...defaultContent,heading:'<script>alert("x")</script>'},"https://example.com/unsubscribe","123 Main Street");
  assert.ok(!html.includes("<script>"));assert.ok(html.includes("&lt;script&gt;"));assert.ok(html.includes("123 Main Street"));assert.ok(html.includes("unsubscribe"));
  assert.throws(()=>safeUrl("javascript:alert(1)"));assert.throws(()=>safeUrl("https://user:password@example.com"));
  assert.throws(()=>content({...defaultContent,hero:"data:image/svg+xml,xxx"}));
});
test("segment window validation rejects NaN, fractions, and negative windows",()=>{
  for(const v of [NaN,0,-1,2.5,Infinity,3651]) assert.throws(()=>segment({openedDays:v}));
  assert.deepEqual(segment({tag:"B2B",openedDays:365}),{tag:"b2b",openedDays:365});
});
