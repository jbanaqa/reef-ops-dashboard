import fs from "node:fs";
import * as XLSX from "xlsx";
// Convert an export using an explicit field mapping; consent is never guessed.
// Example: tsx scripts/prepare-klaviyo-import.ts export.csv mapping.json output.json
// mapping.json: {"email":"Email","emailStatus":"Email Status","consentAt":"Consent Timestamp","consentSource":"Consent Source"}
const [input, mappingPath, output] = process.argv.slice(2);
if (!input || !mappingPath || !output) throw new Error("Usage: prepare-klaviyo-import.ts input.csv mapping.json output.json");
const mapping = JSON.parse(fs.readFileSync(mappingPath,"utf8")) as Record<string,string>;
const workbook=XLSX.read(fs.readFileSync(input),{type:"buffer",raw:true});
const rows=XLSX.utils.sheet_to_json<Record<string,unknown>>(workbook.Sheets[workbook.SheetNames[0]],{defval:""});
const allowed=["email","phone","shopifyId","name","emailStatus","smsStatus","smsTransactionalStatus","emailSuppressed","smsSuppressed","consentAt","consentSource","emailConsentAt","smsConsentAt","smsTransactionalConsentAt","emailConsentSource","smsConsentSource","lastOpenedAt","lastOrderAt","lists","tags","timezone"];
for(const key of Object.keys(mapping)) if(!allowed.includes(key)) throw new Error(`Unknown target field: ${key}`);
const normalized=rows.map((row,index)=>{
  const result:Record<string,unknown>={};
  for(const [target,source] of Object.entries(mapping)) {
    if(!(source in row)) throw new Error(`Column ${source} missing at row ${index+2}`);
    const value=String(row[source]).trim();if(!value)continue;
    if(["lists","tags"].includes(target)) result[target]=value.split(",").map(s=>s.trim()).filter(Boolean);
    else if(target.endsWith("Suppressed")) { if(!["true","false","yes","no","1","0"].includes(value.toLowerCase())) throw new Error(`Invalid suppression value at row ${index+2}`);result[target]=["true","yes","1"].includes(value.toLowerCase()); }
    else if(target.endsWith("Status")) { const status=value.toUpperCase().replace(/ /g,"_");if(!["SUBSCRIBED","UNSUBSCRIBED","NEVER_SUBSCRIBED"].includes(status))throw new Error(`Map consent status explicitly before import: row ${index+2}`);result[target]=status; }
    else result[target]=value;
  }
  return result;
});
fs.writeFileSync(output,JSON.stringify(normalized,null,2),{flag:"wx"});
console.log(`Prepared ${normalized.length} profiles. Validate/import in batches of 500. No database changes made.`);
