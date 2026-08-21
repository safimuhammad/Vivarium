/** Base fills + transitions for named materials at 1:1, for eye judging. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
const ROOT="/Users/muhammadsafi/Desktop/software-dev/simulation";
const ART=path.join(ROOT,"scratchpad/nirvana-west-live/art");
const OUT=path.join(ROOT,"scratchpad/being-sprite-evidence/nirvana-west-live");
const atlas=JSON.parse(await readFile(path.join(ART,"atlas.json"),"utf8"));
const t=await sharp(path.join(ART,"terrain.png")).ensureAlpha().raw().toBuffer({resolveWithObject:true});
const ids=atlas.terrainGrid.ids, gc=atlas.terrainGrid.columns;
const want=(process.argv[2]||"slab,spoil,slate,cinder").split(",");
// Per material: a 6x4 block of base variants, then a row of its 14 edge masks over slate.
const BW=6, BH=4;
const rowH=(BH+1)*32+22;
const W=Math.max(BW*32, 14*32)+8;
const H=want.length*rowH+8;
const out=Buffer.alloc(W*H*4);
function blit(cell,dx,dy){const sx=(cell%gc)*32,sy=Math.floor(cell/gc)*32;
 for(let j=0;j<32;j++)for(let i=0;i<32;i++){const s=((sy+j)*t.info.width+(sx+i))*4;const a=t.data[s+3];if(a===0)return void 0;
  const x=dx+i,y=dy+j;if(x<0||y<0||x>=W||y>=H)continue;const d=(y*W+x)*4;const k=a/255;
  out[d]=Math.round(t.data[s]*k+out[d]*(1-k));out[d+1]=Math.round(t.data[s+1]*k+out[d+1]*(1-k));out[d+2]=Math.round(t.data[s+2]*k+out[d+2]*(1-k));out[d+3]=255;}}
function blitBlend(cell,dx,dy){const sx=(cell%gc)*32,sy=Math.floor(cell/gc)*32;
 for(let j=0;j<32;j++)for(let i=0;i<32;i++){const s=((sy+j)*t.info.width+(sx+i))*4;const a=t.data[s+3];if(a===0)continue;
  const x=dx+i,y=dy+j;if(x<0||y<0||x>=W||y>=H)continue;const d=(y*W+x)*4;const k=a/255;
  out[d]=Math.round(t.data[s]*k+out[d]*(1-k));out[d+1]=Math.round(t.data[s+1]*k+out[d+1]*(1-k));out[d+2]=Math.round(t.data[s+2]*k+out[d+2]*(1-k));out[d+3]=255;}}
want.forEach((m,mi)=>{
  const y0=4+mi*rowH;
  for(let r=0;r<BH;r++)for(let c=0;c<BW;c++){
    const v=(r*BW+c)%8; const cell=ids.indexOf(`t.${m}.${v}`);
    if(cell<0){console.error("missing t."+m+"."+v);continue;}
    blitBlend(cell,4+c*32,y0+r*32);
  }
  // transitions of m over slate
  const ty=y0+BH*32+18;
  for(let mask=1;mask<=14;mask++){
    const base=ids.indexOf(`t.slate.${mask%8}`); blitBlend(base,4+(mask-1)*32,ty);
    const e=ids.indexOf(`e.${m}.${mask}.0`);
    if(e>=0) blitBlend(e,4+(mask-1)*32,ty);
  }
});
await sharp(out,{raw:{width:W,height:H,channels:4}}).png().toFile(path.join(OUT,process.argv[3]||"materials.png"));
process.stdout.write(`${process.argv[3]||"materials.png"} ${W}x${H} (${want.join(", ")})\n`);
