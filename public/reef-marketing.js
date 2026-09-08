/* Install with data-endpoint pointing to the Reef Ops /api/marketing/storefront URL. */
(() => {
  const script=document.currentScript, endpoint=script?.dataset.endpoint;
  if(!endpoint)return;
  const storage={get:k=>{try{return localStorage.getItem(k)}catch{return null}},set:(k,v)=>{try{localStorage.setItem(k,v)}catch{}}};
  const anonymousId=storage.get("reef-marketing-anon")||crypto.randomUUID();storage.set("reef-marketing-anon",anonymousId);
  const post=async body=>{const r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...body,anonymousId})});const d=await r.json();if(!r.ok)throw Error(d.error||"Signup is temporarily unavailable.");return d;};
  const event=type=>post({action:"event",type,id:crypto.randomUUID(),device:innerWidth<700?"mobile":"desktop"}).catch(()=>{});
  // Theme can call this only after Shopify customer privacy allows marketing analytics.
  window.reefMarketingEvent=(type,productId)=>post({action:"event",type,productId,id:crypto.randomUUID()}).catch(()=>{});
  if(script.dataset.knownCustomer==="true"||storage.get("reef-marketing-submitted"))return;
  if(Date.now()-Number(storage.get("reef-marketing-dismissed")||0)<7*86400000)return;
  setTimeout(async()=>{
    try { if (!(await post({action:"config"})).enabled) return; } catch { return; }
    const dialog=document.createElement("dialog");dialog.style.cssText="border:0;border-radius:18px;padding:28px;max-width:440px;width:calc(100% - 32px);font-family:Arial;color:#163b3b;box-shadow:0 20px 80px #0005";
    dialog.innerHTML='<button aria-label="Close" style="float:right;border:0;background:transparent;font-size:24px">×</button><h2>Welcome to Corals Anonymous</h2><p>Get 10% off your first order.</p><form><label>Email <input name="email" type="email" required style="display:block;width:100%;padding:12px;margin:12px 0"></label><label><input type="checkbox" name="consent" required> I agree to receive marketing emails.</label><input name="website" tabindex="-1" aria-hidden="true" style="display:none"><p><button type="submit" style="background:#087f78;color:white;border:0;padding:14px 20px;border-radius:8px">Sign up</button></p></form><p role="status"></p>';
    const close=()=>{storage.set("reef-marketing-dismissed",String(Date.now()));event("FORM_DISMISSED");dialog.close();dialog.remove();};
    dialog.querySelector("button").onclick=close;dialog.addEventListener("click",e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}});dialog.addEventListener("cancel",close);
    document.body.append(dialog);dialog.showModal();event("FORM_VIEWED");
    const form=dialog.querySelector("form"),status=dialog.querySelector('[role="status"]');
    form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('button[type="submit"]');button.disabled=true;try{const f=new FormData(form);const d=await post({action:"signup",email:f.get("email"),emailConsent:f.get("consent")==="on",website:f.get("website")});storage.set("reef-marketing-submitted","1");storage.set("reef-marketing-session",d.session);status.textContent=d.message;form.innerHTML='<p>After confirming your email, add optional text alerts.</p><label>Phone number (include country code)<input name="phone" type="tel" required style="display:block;width:100%;padding:12px;margin:12px 0"></label><label><input name="consent" type="checkbox" required> I agree to recurring automated marketing texts. Consent is not a condition of purchase. Message and data rates may apply. Reply STOP to cancel.</label><p><button type="submit">Sign up for texts</button> <button type="button">No, I don’t want texts</button></p>';form.querySelector('button[type="button"]').onclick=close;form.onsubmit=async e=>{e.preventDefault();try{const f=new FormData(form);await post({action:"sms",session:d.session,phone:f.get("phone"),smsConsent:f.get("consent")==="on",timezone:Intl.DateTimeFormat().resolvedOptions().timeZone});status.textContent="You’re signed up for text alerts.";form.remove();}catch(err){status.textContent=err.message;}};}catch(err){status.textContent=err.message;button.disabled=false;}};
  },10000);
})();
