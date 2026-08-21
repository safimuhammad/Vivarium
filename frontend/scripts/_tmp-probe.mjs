import { createRegionMapIdentity } from "../src/renderer2d/production/maps/RegionMapIdentity.ts";
import { createRegionMapRecipe, parseRegionMapRecipe, serializeRegionMapRecipe } from "../src/renderer2d/production/maps/RegionMapRecipe.ts";
import { createNirvanaWestRegionMapRecipe } from "../src/renderer2d/production/nirvanaWest/NirvanaWestRegionMapRecipe.ts";
import { createProductionRegionMapRecipe } from "../src/renderer2d/production/maps/ProductionRegionMapRecipe.ts";
import { shelterRenderRect } from "../src/renderer2d/production/productionGeometry.ts";
import { wrapSeamViolations } from "../src/renderer2d/production/navigation/wrapSeams.ts";

const mk = (name, description, connections) => ({ name, description, connections: [...connections],
  energy_rate: 0.2, materials_rate: 0.2, current_energy: 40, current_materials: 40,
  max_energy: 100, max_materials: 100 });
const regions = [
  mk("nirvana", "a once-heavenly landscape, now thinning and picked-over", ["warm_springs", "nirvana_east", "nirvana_west"]),
  mk("nirvana_east", "a struggling, near-barren stretch", ["warm_springs", "nirvana"]),
  mk("warm_springs", "hot spring lakes \u2014 the least-poor refuge, but no longer plentiful", ["nirvana_west", "nirvana_east", "nirvana"]),
  mk("nirvana_west", "a nuclear wasteland, all but dead", ["warm_springs", "nirvana"]),
];
const region = regions[3];
for (const seed of [401, 229, 7, 1337]) {
  const identity = createRegionMapIdentity(seed, region, regions);
  const generic = createRegionMapRecipe(identity);
  const t0 = Date.now();
  const west = createNirvanaWestRegionMapRecipe(identity);
  const ms = Date.now() - t0;
  const { columns, rows, collision } = west.grid;
  // plots lost, using the REAL shelterRenderRect
  let lost = 0;
  for (const plot of west.shelterPlots) {
    const r = shelterRenderRect(plot.tile);
    let bad = false;
    for (let row = Math.floor(r.y/32); row <= Math.floor((r.y+r.height-1)/32) && !bad; row++)
      for (let col = Math.floor(r.x/32); col <= Math.floor((r.x+r.width-1)/32) && !bad; col++)
        if (row>=0&&col>=0&&row<rows&&col<columns&&collision[row*columns+col]===1) bad = true;
    if (bad) lost++;
  }
  // walkable components (toroidal)
  const seen = new Uint8Array(columns*rows); const comps = [];
  const wrap=(v,n)=>((v%n)+n)%n;
  for (let i=0;i<collision.length;i++){
    if (collision[i]===1||seen[i]) continue;
    let n=0; const stack=[i]; seen[i]=1;
    while(stack.length){const k=stack.pop(); n++;
      const c=k%columns, r=(k-c)/columns;
      for (const [dc,dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nc=wrap(c+dc,columns), nr=wrap(r+dr,rows), nk=nr*columns+nc;
        if (collision[nk]===0 && !seen[nk]) { seen[nk]=1; stack.push(nk); }
      }}
    comps.push(n);
  }
  comps.sort((a,b)=>b-a);
  const blocked = collision.reduce((s,v)=>s+v,0);
  const violations = wrapSeamViolations(west.grid);
  const openRim = [];
  for (let c=0;c<columns;c++){ if(collision[c]===0) openRim.push(`(${c},0)`); if(collision[(rows-1)*columns+c]===0) openRim.push(`(${c},${rows-1})`); }
  for (let r=0;r<rows;r++){ if(collision[r*columns]===0) openRim.push(`(0,${r})`); if(collision[r*columns+columns-1]===0) openRim.push(`(${columns-1},${r})`); }
  // parse round trip through the FULL generic validation
  let parseOk = "ok";
  try { parseRegionMapRecipe(serializeRegionMapRecipe(west), identity, (id)=>createProductionRegionMapRecipe(id)); }
  catch (e) { parseOk = "THREW: " + e.message; }
  console.log(JSON.stringify({ seed, buildMs: ms, kit: west.kit,
    profile: west.presentationProfile?.kind, sceneHash: west.presentationProfile?.staticSceneHash,
    plotsLost: lost, of: west.shelterPlots.length,
    blocked, blockedPct: +(blocked/(columns*rows)*100).toFixed(2),
    components: comps.slice(0,6), componentCount: comps.length,
    genericAnimated: generic.animatedEnvironment.length, westAnimated: west.animatedEnvironment.length,
    animatedKinds: [...new Set(west.animatedEnvironment.map(p=>p.kind))],
    wrapSeamViolations: violations.length, openRimTiles: openRim,
    staticScenerySame: JSON.stringify(west.staticScenery)===JSON.stringify(generic.staticScenery),
    pathMaskSame: Buffer.compare(Buffer.from(west.pathMask),Buffer.from(generic.pathMask))===0,
    parse: parseOk }));
}
