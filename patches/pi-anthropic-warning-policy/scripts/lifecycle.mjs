#!/usr/bin/env node
import fs from "node:fs";
const args=process.argv.slice(2); const action=args.shift();
const arg=(name)=>{const index=args.indexOf(name); return index>=0?args[index+1]:"";};
const manifest=JSON.parse(fs.readFileSync(arg("--manifest"),"utf8"));
const result={
  ok:true,
  blocked:false,
  noop:true,
  writes:0,
  policy:manifest.policy,
  targets:[{id:"upstream-warning-copy",status:"retired-noop"}],
  checks:[{id:"no-installed-doc-or-warning-mutation",passed:true}]
};
if(!["status","plan","verify","apply","rollback"].includes(action)) throw new Error(`Unsupported action: ${action}`);
process.stdout.write(JSON.stringify(action==="apply"?{ok:true,receipt:{targets:[]},result:{writes:0}}:action==="rollback"?{ok:true,result:{writes:0}}:result));
