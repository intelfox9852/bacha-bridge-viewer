// Coarse environment DEM and the existing project TIN remain separate sources.
// The project patch follows the same ENU frame as the bridge models.
export function makeProjectSampler(surface,river){
 const cells=new Map(),size=25;
 for(const m of surface.meshes)for(const f of m.f){
  const p=f.map(i=>m.v[i]);const area=(p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[2][0]-p[0][0])*(p[1][1]-p[0][1]);
  const tri={p,area};for(let x=Math.floor(Math.min(...p.map(q=>q[0]))/size);x<=Math.floor(Math.max(...p.map(q=>q[0]))/size);x++)for(let y=Math.floor(Math.min(...p.map(q=>q[1]))/size);y<=Math.floor(Math.max(...p.map(q=>q[1]))/size);y++){const key=x+','+y;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(tri)}
 }
 const rows=river.rows;
 return (x,y)=>{
  if(y>=rows[0].y&&y<=rows.at(-1).y){
   let lo=0,hi=rows.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(rows[mid].y<=y)lo=mid;else hi=mid}
   const a=rows[lo],b=rows[hi],t=(y-a.y)/(b.y-a.y),v=k=>a[k]+t*(b[k]-a[k]);const l=v('left'),r=v('right'),fl=v('floor_left'),fr=v('floor_right');
   if(x>=l&&x<=r){if(x<fl)return v('left_z')+(river.design_bed_elevation-v('left_z'))*(x-l)/(fl-l);if(x>fr)return river.design_bed_elevation+(v('right_z')-river.design_bed_elevation)*(x-fr)/(r-fr);return river.design_bed_elevation}
  }
  for(const {p:[a,b,c],area} of cells.get(Math.floor(x/size)+','+Math.floor(y/size))||[]){
   const u=((b[0]-x)*(c[1]-y)-(c[0]-x)*(b[1]-y))/area,v=((c[0]-x)*(a[1]-y)-(a[0]-x)*(c[1]-y))/area,w=1-u-v;
   if(u>=-1e-7&&v>=-1e-7&&w>=-1e-7)return u*a[2]+v*b[2]+w*c[2];
  }
  return null;
 };
}

export function makeEnvironmentTerrain(C,{getFrame,sampler,useDem,getProjectVisible,stats,onChange}){
 const scheme=new C.WebMercatorTilingScheme(),cache=new Map(),R=6378137,width=65;
 async function tile(z,x,y){
  const key=z+'/'+x+'/'+y;if(cache.has(key))return cache.get(key);
  const promise=(async()=>{
   const url='https://s3.amazonaws.com/elevation-tiles-prod/terrarium/'+key+'.png';
   try{
    const response=await fetch(url,{signal:AbortSignal.timeout(12000)});if(!response.ok)throw new Error('HTTP '+response.status);
    const image=await createImageBitmap(await response.blob(),{premultiplyAlpha:'none',colorSpaceConversion:'none'}),canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);image.close();
    const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data,heights=new Float32Array(canvas.width*canvas.height);
    for(let i=0;i<heights.length;i++)heights[i]=rgba[4*i]*256+rgba[4*i+1]+rgba[4*i+2]/256-32768;
    stats.demTiles++;onChange();return {heights,width:canvas.width};
   }catch(error){stats.demFailures++;onChange();return null}
  })();cache.set(key,promise);if(cache.size>96)cache.delete(cache.keys().next().value);return promise;
 }
 return new C.CustomHeightmapTerrainProvider({width,height:width,tilingScheme:scheme,credit:new C.Credit('Terrain Tiles / Tilezen · <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank">SRTM 等公开DEM</a>',true),callback:async(x,y,level)=>{
  const z=Math.min(level,14),factor=2**(level-z),data=useDem?await tile(z,Math.floor(x/factor),Math.floor(y/factor)):null,out=new Float32Array(width*width),rect=scheme.tileXYToNativeRectangle(x,y,level),frame=getFrame();
  const sample=(u,v)=>{if(!data)return 0;const w=data.width,px=Math.max(0,Math.min(w-1,u*(w-1))),py=Math.max(0,Math.min(w-1,v*(w-1))),ix=Math.floor(px),iy=Math.floor(py),jx=Math.min(ix+1,w-1),jy=Math.min(iy+1,w-1),tx=px-ix,ty=py-iy,h=data.heights;return (h[iy*w+ix]*(1-tx)+h[iy*w+jx]*tx)*(1-ty)+(h[jy*w+ix]*(1-tx)+h[jy*w+jx]*tx)*ty};
  for(let row=0;row<width;row++)for(let col=0;col<width;col++){
   const u=col/(width-1),v=row/(width-1);let h=sample((x%factor+u)/factor,(y%factor+v)/factor);
   const lon=(rect.west+(rect.east-rect.west)*u)/R,lat=Math.atan(Math.sinh((rect.north+(rect.south-rect.north)*v)/R));
   const de=(lon-frame.lon)*frame.eastRadius,dn=(lat-frame.lat)*frame.northRadius,lx=de*frame.cos+dn*frame.sin,ly=-de*frame.sin+dn*frame.cos;
   if(lx>=-650&&lx<=550&&ly>=-300&&ly<=300){const local=sampler(lx,ly);if(local!==null)h=local+frame.height-(getProjectVisible()?2:0)}
   out[row*width+col]=h;
  }
  stats.terrainTiles++;return out;
 }});
}
