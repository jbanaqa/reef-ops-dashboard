import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { atomic, consent, identify, json, record, shop } from "@/lib/marketing/store";
import { defaultContent, email, phone } from "@/lib/marketing/rules";
import { setup } from "@/lib/marketing/delivery";
export const dynamic = "force-dynamic";
const headers = () => ({ "Access-Control-Allow-Origin": process.env.MARKETING_STOREFRONT_ORIGIN || "https://coralsanonymous.com", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin", "Cache-Control": "no-store" });
export function OPTIONS() { return new Response(null, { status: 204, headers: headers() }); }
export async function POST(request: Request) {
  if (!process.env.MARKETING_STOREFRONT_ORIGIN || request.headers.get("origin") !== process.env.MARKETING_STOREFRONT_ORIGIN) return new Response("Origin denied", { status: 403 });
  const reply = (data: unknown, status=200) => Response.json(data,{status,headers:headers()});
  const config = setup();
  if (!config.formEnabled || !config.sendingEnabled || !config.migrationConfirmed || !config.emailReady || !config.couponReady) return reply({ enabled:false, error:"Signup is not enabled yet." },503);
  try {
    const raw=await request.text(); if(raw.length>16000) return reply({error:"Payload too large"},413);
    const b=JSON.parse(raw);
    if (b.action === "config") {
      const welcome = await prisma.marketingResource.findUnique({ where: { shop_kind_key: { shop:shop(), kind:"FLOW", key:"welcome" } } });
      return reply({ enabled: !!welcome?.enabled && (welcome.data as { reviewed?:boolean }).reviewed === true });
    }
    if (b.website) return reply({ok:true}); // honeypot
    // Limit abuse with a database counter, shared by all application instances.
    const bucket=crypto.createHash("sha256").update(`${request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown"}:${Math.floor(Date.now()/3600000)}`).digest("hex");
    await atomic(async tx=>{
      const key=`rate:${bucket}`;
      const r=await tx.marketingResource.findUnique({where:{shop_kind_key:{shop:shop(),kind:"RATE",key}}});
      const count=Number((r?.data as {count?:number})?.count||0);
      if(count>=200) throw new Error("Too many requests. Try again later.");
      await tx.marketingResource.upsert({where:{shop_kind_key:{shop:shop(),kind:"RATE",key}},create:{shop:shop(),kind:"RATE",key,name:"Storefront rate limit",data:{count:1}},update:{data:{count:count+1}}});
    });
    if(b.action==="signup") {
      const welcome = await prisma.marketingResource.findUnique({ where: { shop_kind_key: { shop:shop(), kind:"FLOW", key:"welcome" } } });
      if (!welcome?.enabled || !(welcome.data as {reviewed?:boolean}).reviewed) throw new Error("Signup is temporarily unavailable.");
      if(b.emailConsent!==true) throw new Error("Email marketing consent is required.");
      const address=email(b.email), session=crypto.randomUUID();
      await atomic(async tx=>{
        const p=await identify(tx,{email:address});
        const existing=await tx.marketingConsent.findUnique({where:{profileId_channel:{profileId:p.id,channel:"EMAIL"}}});
        await record(tx,{key:`form:${session}`,type:"FORM_EMAIL_SUBMITTED",profileId:p.id,payload:{disclosure:"Email marketing; 10% first order offer",version:"v1"}});
        if(existing?.suppressed || existing?.status==="SUBSCRIBED") return;
        const recent=await tx.marketingMessage.findFirst({where:{profileId:p.id,flowKey:"email-confirmation",createdAt:{gte:new Date(Date.now()-86400000)}}});
        if(recent) return;
        await tx.marketingResource.create({data:{shop:shop(),kind:"SIGNUP",key:session,name:"Pending email confirmation",data:{profileId:p.id,expiresAt:new Date(Date.now()+86400000).toISOString(),confirmed:false,anonymousId:typeof b.anonymousId==="string"?b.anonymousId.slice(0,100):""}}});
        await tx.marketingMessage.create({data:{shop:shop(),key:`confirmation:${session}`,profileId:p.id,flowKey:"email-confirmation",channel:"EMAIL",subject:"Confirm your Corals Anonymous email signup",content:json({...defaultContent,heading:"Confirm your email",body:"You requested email updates and a first-order offer. Confirm your email to complete signup. If you did not request this, ignore this message.",button:"Confirm email",url:`${process.env.APP_BASE_URL}/api/marketing/confirm?token=${session}`}),dueAt:new Date()}});
      });
      return reply({ok:true,session,message:"Check your email to confirm your signup. Your 10% offer follows confirmation."});
    }
    if(b.action==="sms") {
      if(b.smsConsent!==true) throw new Error("Explicit SMS marketing consent is required.");
      const number=phone(b.phone);
      await atomic(async tx=>{
        const session=await tx.marketingResource.findUnique({where:{shop_kind_key:{shop:shop(),kind:"SIGNUP",key:String(b.session)}}});
        const d=session?.data as {profileId:string;confirmed:boolean;expiresAt:string}|undefined;
        if(!d?.confirmed || new Date(d.expiresAt)<new Date()) throw new Error("Confirm your email first, then return here to add SMS.");
        const p=await tx.marketingProfile.findUniqueOrThrow({where:{id:d.profileId}});
        await identify(tx,{email:p.email!,phone:number});
        if(!b.timezone) throw new Error("Timezone is required.");
        new Intl.DateTimeFormat("en",{timeZone:String(b.timezone)}).format();
        await tx.marketingProfile.update({where:{id:p.id},data:{properties:json({...p.properties as object,timezone:b.timezone})}});
        await consent(tx,p.id,"SMS_MARKETING","SUBSCRIBED","storefront-explicit-sms-v1",new Date());
        await record(tx,{key:`form-sms:${session!.key}`,type:"FORM_SMS_SUBMITTED",profileId:p.id,payload:{version:"v1",disclosure:"Recurring automated marketing texts; consent not a condition of purchase; message/data rates may apply; STOP to cancel."}});
      });return reply({ok:true});
    }
    if(b.action==="event") {
      if(!["FORM_VIEWED","FORM_DISMISSED","PRODUCT_VIEWED","ADDED_TO_CART","CHECKOUT_STARTED"].includes(b.type)) throw new Error("Unsupported storefront event.");
      if(!/^[a-zA-Z0-9_-]{10,100}$/.test(b.anonymousId)||!b.id) throw new Error("Anonymous event identity required.");
      // Untrusted browser events remain anonymous and cannot assert purchases, consent or Shopify IDs.
      await atomic(tx=>record(tx,{key:`browser:${String(b.id).slice(0,100)}`,type:b.type,anonymousId:b.anonymousId,payload:{productId:String(b.productId||"").slice(0,100),device:b.device==="mobile"?"mobile":"desktop"}}));
      return reply({ok:true});
    }
    if(b.action==="status") {
      const r=await prisma.marketingResource.findUnique({where:{shop_kind_key:{shop:shop(),kind:"SIGNUP",key:String(b.session||"")}}});
      return reply({known:!!r,confirmed:!!(r?.data as {confirmed?:boolean})?.confirmed});
    }
    throw new Error("Unsupported action.");
  }catch(e){return reply({error:e instanceof Error?e.message:"Request failed"},400);}
}
