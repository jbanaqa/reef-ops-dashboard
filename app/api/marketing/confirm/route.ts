import { atomic, consent, record, shop } from "@/lib/marketing/store";
import { enroll } from "@/lib/marketing/flows";
export const dynamic="force-dynamic";
export async function GET() { return new Response('<html><body><h1>Confirm your email signup</h1><p>Confirm to receive Corals Anonymous marketing emails and your first-order offer.</p><form method="post"><button>Confirm email marketing signup</button></form></body></html>',{headers:{"Content-Type":"text/html","Cache-Control":"no-store","Referrer-Policy":"no-referrer"}}); }
export async function POST(request:Request) {
  try{
    const token=new URL(request.url).searchParams.get("token")||"";
    await atomic(async tx=>{
      const r=await tx.marketingResource.findUnique({where:{shop_kind_key:{shop:shop(),kind:"SIGNUP",key:token}}});
      const d=r?.data as {profileId:string;expiresAt:string;confirmed:boolean;anonymousId?:string}|undefined;
      if(!d||new Date(d.expiresAt)<new Date()) throw new Error("This confirmation link has expired.");
      if(d.confirmed)return;
      await consent(tx,d.profileId,"EMAIL","SUBSCRIBED","storefront-confirmed-v1",new Date());
      await tx.marketingResource.update({where:{id:r!.id},data:{data:{...d,confirmed:true}}});
      await record(tx,{key:`confirmed:${token}`,type:"FORM_EMAIL_CONFIRMED",profileId:d.profileId});
      if(d.anonymousId) await tx.marketingEvent.updateMany({where:{shop:shop(),anonymousId:d.anonymousId,profileId:null},data:{profileId:d.profileId}});
      await enroll(tx,"welcome",d.profileId,token,new Date());
    });return new Response("Email confirmed. You can return to the store to add optional SMS updates.");
  }catch(e){return new Response(e instanceof Error?e.message:"Confirmation failed",{status:400});}
}
