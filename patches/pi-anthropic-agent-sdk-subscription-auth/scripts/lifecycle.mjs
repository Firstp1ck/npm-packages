#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const args=process.argv.slice(2); const action=args.shift();
const arg=(name)=>{const index=args.indexOf(name); return index>=0?args[index+1]:"";};
const manifestPath=arg("--manifest"); const manifest=JSON.parse(fs.readFileSync(manifestPath,"utf8"));
const root=path.dirname(manifestPath);
const components=manifest.components.map((relative)=>({path:path.resolve(root,relative),exists:fs.existsSync(path.resolve(root,relative,"PATCH.md"))}));
const ok=components.every((component)=>component.exists);
const common={ok,blocked:!ok,noop:true,writes:0,components,targets:components.map((component,index)=>({id:manifest.targets[index]?.id||`component-${index+1}`,status:component.exists?"split-component-ready":"missing"}))};
if(action==="apply") process.stdout.write(JSON.stringify({ok:true,receipt:{targets:[]},result:{writes:0,components}}));
else if(action==="rollback") process.stdout.write(JSON.stringify({ok:true,result:{writes:0}}));
else if(["status","plan","verify"].includes(action)) process.stdout.write(JSON.stringify(common));
else throw new Error(`Unsupported action: ${action}`);
