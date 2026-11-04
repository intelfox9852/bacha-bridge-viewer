import * as T from 'three/webgpu';

// Terrain retains its survey coordinates and elevations independently of bridge
// mesh display modes, selection indices, and measurements.
export async function createTerrainBasemap({scene,renderer,camera,controls,invalidate,beforeFrame}){
 const $=id=>document.getElementById(id),button=$('terrainToggle'),viewButton=$('terrainView'),opacity=$('terrainOpacity'),status=$('terrainStatus');
 const surfaceButton=$('terrainSurface'),shadeButton=$('terrainShade'),pointButton=$('terrainPoints'),detailButton=$('terrainDetail');
 const planButton=$('terrainPlan'),bedButton=$('riverBedToggle'),waterButton=$('riverWaterToggle'),waterOpacity=$('riverWaterOpacity');
 const response=await fetch('./地形底图配准.json?v=a4fb60373ede');if(!response.ok)throw new Error('配准文件 HTTP '+response.status);
 const metadata=await response.json(),root=new T.Group();root.name='测绘地形';
 const plan=new T.Group(),context=new T.Group(),land=new T.Group();plan.name='0m参考面底图';context.name='河道镂空参考底图';land.name='实测点插值陆域地表';root.add(plan,context,land);
 let shown=true,isolated=false,is3D=true,heightColors=true,pointsVisible=false,surface=null,pointCloud=null;
 let river=null,bedMesh=null,waterMesh=null,planWater=null,bedShown=true,waterShown=true;
 const suffix=metadata.revision?'?v='+encodeURIComponent(metadata.revision):'';
 const sync=()=>{
  root.visible=shown&&!isolated;plan.visible=!is3D||!river;context.visible=is3D;land.visible=is3D;pointCloud&&(pointCloud.visible=is3D&&pointsVisible);
  if(river){bedMesh.visible=is3D&&bedShown;waterMesh.visible=is3D&&waterShown;planWater.visible=!is3D&&waterShown}
  button.textContent=shown?'地形：显示':'地形：隐藏';button.setAttribute('aria-pressed',String(shown));
  surfaceButton.textContent='显示三维地形';surfaceButton.setAttribute('aria-pressed',String(is3D));planButton.setAttribute('aria-pressed',String(!is3D));
  bedButton.textContent=bedShown?'河床：显示':'河床：隐藏';bedButton.setAttribute('aria-pressed',String(bedShown));bedButton.disabled=!river||!is3D;
  waterButton.textContent=waterShown?'蓝色水体：显示':'蓝色水体：隐藏';waterButton.setAttribute('aria-pressed',String(waterShown));
  shadeButton.textContent=heightColors?'着色：高程':'着色：测绘';shadeButton.setAttribute('aria-pressed',String(heightColors));
  pointButton.textContent=pointsVisible?'测点：显示':'测点：隐藏';pointButton.setAttribute('aria-pressed',String(pointsVisible));
  shadeButton.disabled=!surface||!is3D;pointButton.disabled=!surface||!is3D;
  status.textContent=is3D&&surface?`三维地形 · 陆域${surface.observations.length}个测点 · ${river?'设计河床−2.80m · 参考水面＋2.20m':'原始高程'} · 无竖向夸大`:'平面地形 · 0m参考面 · 河道蓝色填充';
  $('terrainLegend').hidden=!is3D||!heightColors||!surface;
  invalidate();
 };
 const loader=new T.TextureLoader();
 try{
  const tiles=await Promise.all(metadata.tiles.map(async tile=>{
   const texture=await loader.loadAsync('./'+tile.image+suffix);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=Math.min(4,renderer.getMaxAnisotropy());
   const [xmin,xmax,ymin,ymax]=tile.bounds;
   const geometry=new T.PlaneGeometry(xmax-xmin,ymax-ymin);geometry.rotateX(-Math.PI/2);
   const material=new T.MeshBasicMaterial({map:texture,transparent:true,opacity:Number(opacity.value)/100,side:T.DoubleSide,depthWrite:false});
   const mesh=new T.Mesh(geometry,material);
   // Raster top = positive local Y (the left/north normal). After -90°
   // rotation the plane top is negative world Z = -local Y, matching the model.
   mesh.position.set((xmin+xmax)/2,metadata.plan_elevation,-(ymin+ymax)/2);return mesh;
  }));
  plan.add(...tiles);scene.add(root);
 }catch(error){root.traverse(o=>{o.geometry?.dispose();o.material?.map?.dispose();o.material?.dispose()});throw error}
 try{
  const response=await fetch('./terrain/surface.json'+suffix);if(!response.ok)throw new Error('高程数据 HTTP '+response.status);surface=await response.json();
  const [zmin,zmax]=surface.height_range;
  const stops=[[zmin,0x487fa7],[1.5,0x4a8a67],[2.5,0x82a86c],[3.3,0xb8bc84],[zmax,0xd5bb8a]];
  const elevationColor=z=>{let i=stops.findIndex((p,i)=>i>0&&z<=p[0]);if(i<1)i=stops.length-1;const a=stops[i-1],b=stops[i];return new T.Color(a[1]).lerp(new T.Color(b[1]),Math.max(0,Math.min(1,(z-a[0])/(b[0]-a[0]))))};
  for(let i=0;i<surface.meshes.length;i++){
   const m=surface.meshes[i],[xmin,xmax,ymin,ymax]=m.bounds,geometry=new T.BufferGeometry();
   geometry.setAttribute('position',new T.Float32BufferAttribute(m.v.flatMap(([x,y,z])=>[x,z,-y]),3));geometry.setIndex(m.f.flat());
   geometry.setAttribute('uv',new T.Float32BufferAttribute(m.v.flatMap(([x,y])=>[(x-xmin)/(xmax-xmin),(y-ymin)/(ymax-ymin)]),2));
   geometry.setAttribute('color',new T.Float32BufferAttribute(m.v.flatMap(([x,y,z])=>{const c=elevationColor(z);return [c.r,c.g,c.b]}),3));geometry.computeVertexNormals();geometry.computeBoundingSphere();
   const material=new T.MeshLambertMaterial({color:0xffffff,map:plan.children[i].material.map,vertexColors:heightColors,transparent:true,opacity:Number(opacity.value)/100,depthWrite:true,side:T.DoubleSide});
   const mesh=new T.Mesh(geometry,material);mesh.renderOrder=1;land.add(mesh);
  }
  pointCloud=new T.Points(new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(surface.observations.flatMap(p=>[p.x,p.z+.04,-p.y]),3)),new T.PointsMaterial({color:0xf7b43c,size:4,sizeAttenuation:false}));pointCloud.renderOrder=2;root.add(pointCloud);
  const ambient=new T.AmbientLight(0xffffff,.65),sun=new T.DirectionalLight(0xfff7e5,.65);sun.position.set(-200,400,150);root.add(ambient,sun);
  $('terrainLegend').textContent=`陆域插值高程：${zmin.toFixed(3)}m（蓝绿） → ${zmax.toFixed(3)}m（黄褐）`;
  status.title=surface.notes.join('\n');
 }catch(error){is3D=false;console.warn('三维地形未加载，保留平面底图',error);status.title='三维高程数据加载失败，已显示平面底图，可刷新重试。'}
 try{
  const response=await fetch('./terrain/river.json'+suffix);if(!response.ok)throw new Error('河道模型 HTTP '+response.status);const data=await response.json();
  const geometryOf=m=>{const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(m.v.flatMap(([x,y,z])=>[x,z,-y]),3));g.setIndex(m.f.flat());g.computeVertexNormals();g.computeBoundingSphere();return g};
  for(let i=0;i<data.reference_tiles.length;i++){
   const m=data.reference_tiles[i],g=geometryOf(m),[xmin,xmax,ymin,ymax]=m.bounds;
   g.setAttribute('uv',new T.Float32BufferAttribute(m.v.flatMap(([x,y])=>[(x-xmin)/(xmax-xmin),(y-ymin)/(ymax-ymin)]),2));
   context.add(new T.Mesh(g,plan.children[i].material.clone()));
  }
  bedMesh=new T.Mesh(geometryOf(data.bed),new T.MeshLambertMaterial({color:0xa58a69,side:T.DoubleSide}));bedMesh.name='设计河床 −2.80m';root.add(bedMesh);
  waterMesh=new T.Mesh(geometryOf(data.water),new T.MeshBasicMaterial({color:0x168dd4,transparent:true,opacity:Number(waterOpacity.value)/100,side:T.FrontSide,depthWrite:false}));waterMesh.name='蓝色水体 · 最高通航参考水位＋2.20m';waterMesh.renderOrder=2;root.add(waterMesh);
  planWater=new T.Mesh(geometryOf(data.plan_water),new T.MeshBasicMaterial({color:0x168dd4,transparent:true,opacity:Number(waterOpacity.value)/100,side:T.DoubleSide,depthWrite:false}));planWater.renderOrder=2;root.add(planWater);
  river=data;status.title=[...surface?.notes||[],...data.notes].join('\n');
 }catch(error){console.warn('河道模型未加载',error);$('terrainNote').textContent='河床与水体加载失败，可刷新重试。'}
 button.disabled=false;viewButton.disabled=false;opacity.disabled=false;surfaceButton.disabled=!surface;detailButton.disabled=!surface;planButton.disabled=false;waterButton.disabled=!river;waterOpacity.disabled=!river;
 if(river)$('terrainNote').textContent='河床顺接部分为示意；水面采用最高通航水位，非实时水位。';
 button.onclick=()=>{shown=!shown;sync()};
 surfaceButton.onclick=()=>{beforeFrame();is3D=true;shown=true;sync()};planButton.onclick=()=>{beforeFrame();is3D=false;shown=true;sync()};
 bedButton.onclick=()=>{bedShown=!bedShown;sync()};waterButton.onclick=()=>{waterShown=!waterShown;sync()};
 waterOpacity.oninput=()=>{if(river){waterMesh.material.opacity=Number(waterOpacity.value)/100;planWater.material.opacity=Number(waterOpacity.value)/100;invalidate()}};
 shadeButton.onclick=()=>{heightColors=!heightColors;for(const m of land.children){m.material.vertexColors=heightColors;m.material.needsUpdate=true}sync()};
 pointButton.onclick=()=>{pointsVisible=!pointsVisible;sync()};
 opacity.oninput=()=>{for(const m of [...plan.children,...context.children,...land.children])m.material.opacity=Number(opacity.value)/100;invalidate()};
 viewButton.onclick=()=>{
  beforeFrame();shown=true;isolated=false;sync();
  const [xmin,xmax,ymin,ymax]=metadata.bounds,span=Math.max((xmax-xmin)*1.12,(ymax-ymin)*innerWidth/innerHeight*1.12);
  camera.left=-span/2;camera.right=span/2;camera.top=span/2*innerHeight/innerWidth;camera.bottom=-camera.top;camera.zoom=1;camera.updateProjectionMatrix();
  const target=new T.Vector3((xmin+xmax)/2,0,-(ymin+ymax)/2);controls.target.copy(target);camera.position.copy(target).add(new T.Vector3(0,700,420));camera.up.set(0,1,0);controls.update();invalidate();
 };
 detailButton.onclick=()=>{
  beforeFrame();shown=true;isolated=false;is3D=true;sync();
  const span=210;camera.left=-span/2;camera.right=span/2;camera.top=span/2*innerHeight/innerWidth;camera.bottom=-camera.top;camera.zoom=1;camera.updateProjectionMatrix();
  const target=new T.Vector3(-40,4,0);controls.target.copy(target);camera.position.copy(target).add(new T.Vector3(60,38,155));camera.up.set(0,1,0);controls.update();invalidate();
 };
 sync();return {root,plan,context,land,metadata,surface,river,bedMesh,waterMesh,planWater,pointCloud,setIsolated(value){isolated=value;sync()},get shown(){return shown},get is3D(){return is3D}};
}
