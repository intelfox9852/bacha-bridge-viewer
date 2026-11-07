import {createSiteFeatures} from './site_features.js?v=14c89545d6f9';
import * as T from 'three/webgpu';
import {cameraPosition, color, dot, exp, float, mix, normalize, positionWorld, reflector, sin, uniform, vec2, vec3} from './vendor/three.tsl.js';

function referenceWaterMaterial(clock, opacity, strength=1, reflection=null){
 const p=positionWorld.xz;
 const flow=clock.mul(.18);
 const waveA=sin(p.x.mul(1.67).add(p.y.mul(.93)).add(flow));
 const waveB=sin(p.x.mul(1.13).sub(p.y.mul(2.10)).sub(flow.mul(.7)));
 const normal=normalize(vec3(waveA.mul(.005),1,waveB.mul(.004)));
 const view=normalize(cameraPosition.sub(positionWorld));
 const grazing=float(1).sub(dot(view,normal).clamp(0,1)).pow(3);
 // A broad, soft environment highlight like the reference recording. The
 // normal ripples affect shading only, leaving the surveyed water level fixed.
 const cameraAxis=normalize(cameraPosition.xz.sub(vec2(-5,0)));
 const across=vec2(cameraAxis.y,cameraAxis.x.negate());
 const bandDistance=dot(p.sub(vec2(-9,0)),across).div(18);
 const band=exp(bandDistance.mul(bandDistance).negate().mul(.65));
 const longWave=sin(p.x.mul(.023).add(p.y.mul(.017)).add(clock.mul(.04)));
 const body=mix(color(0x133d60),color(0x245f88),longWave.mul(.14).add(.4));
 const shimmer=waveA.mul(waveB).mul(.008*strength);
 const highlight=band.mul(.42*strength).add(grazing.mul(.10*strength)).add(shimmer);
 let top=body.add(color(0x8bb9df).mul(highlight));
 if(reflection){
  const reflected=reflection.sample(reflection.uvNode.add(vec2(waveA,waveB).mul(.00075))).level(1.4);
  const fresnel=float(1).sub(dot(view,normal).clamp(0,1)).pow(5).mul(.98).add(.02);
  top=mix(body,reflected.rgb.mul(vec3(.52,.75,1)),fresnel);
 }
 const material=new T.MeshBasicNodeMaterial({transparent:opacity<1,opacity,side:T.FrontSide,depthWrite:false});
 material.colorNode=mix(color(0x164563),top,positionWorld.y.sub(-2.8).div(5).clamp(0,1));
 return material;
}

function createRiverReflection(root, scene, level){
 const mirror=reflector({resolutionScale:.5,generateMipmaps:true,bounces:false});
 mirror.target.rotation.x=-Math.PI/2;mirror.target.position.y=level;root.add(mirror.target);
 // Only the reflected camera sees the sky environment. It illuminates the
 // reflection texture without changing the engineering model's materials.
 const direction=normalize(positionWorld);
 const sky=new T.MeshBasicNodeMaterial({side:T.BackSide,depthWrite:false});
 const skyGradient=mix(color(0xc3d9df),color(0x537ea6),direction.y.clamp(0,1).pow(.5));
 const sun=dot(direction,normalize(vec3(-.20,.65,-.73))).max(0);
 const cloud=sin(direction.x.mul(9).add(direction.z.mul(4))).mul(.03);
 sky.colorNode=skyGradient.add(vec3(1.1,1.02,.85).mul(sun.pow(28))).add(cloud);
 const dome=new T.Mesh(new T.SphereGeometry(2200,32,16),sky);dome.name='水面反射天空';dome.layers.set(31);scene.add(dome);
 const getCamera=mirror.reflector.getVirtualCamera.bind(mirror.reflector);
 mirror.reflector.getVirtualCamera=camera=>{const virtual=getCamera(camera);virtual.layers.enable(31);return virtual};
 return mirror;
}

// Terrain retains its survey coordinates and elevations independently of bridge
// mesh display modes, selection indices, and measurements.
export async function createTerrainBasemap({scene,renderer,camera,controls,invalidate,beforeFrame}){
 const $=id=>document.getElementById(id),button=$('terrainToggle'),viewButton=$('terrainView'),opacity=$('terrainOpacity'),status=$('terrainStatus');
 const surfaceButton=$('terrainSurface'),shadeButton=$('terrainShade'),pointButton=$('terrainPoints'),detailButton=$('terrainDetail');
 const planButton=$('terrainPlan'),bedButton=$('riverBedToggle'),waterButton=$('riverWaterToggle'),waterOpacity=$('riverWaterOpacity');
 const response=await fetch('./地形底图配准.json?v=14c89545d6f9');if(!response.ok)throw new Error('配准文件 HTTP '+response.status);
 const metadata=await response.json(),root=new T.Group();root.name='测绘地形';
 const plan=new T.Group(),context=new T.Group(),land=new T.Group();plan.name='0m参考面底图';context.name='河道镂空参考底图';land.name='实测点插值陆域地表';root.add(plan,context,land);
 let shown=true,isolated=false,is3D=true,heightColors=true,pointsVisible=false,surface=null,pointCloud=null;
 let features=null,planLand=null,planPonds=null;let river=null,bedMesh=null,waterMesh=null,planWater=null,bedShown=true,waterShown=true;
 const waterClock=uniform(0);
 let waterFrame=0,lastWaterFrame=0,softWater=true,pondBatch=null,pondFlatMaterial=null,pondSoftMaterial=null;
 let flatWaterMaterial=null,softWaterMaterial=null;
 const waterStyle=document.createElement('button');waterStyle.id='riverWaterStyle';waterStyle.textContent='水面：场景反射';waterStyle.setAttribute('aria-pressed','true');waterButton.after(waterStyle);
 function animateWater(now){
  waterFrame=0;
  if(!softWater||!shown||isolated||!is3D||document.hidden)return;
  const pondsVisible=pondBatch?.mesh.visible&&features?.group.visible;
  if(!waterShown&&!pondsVisible)return;
  if(now-lastWaterFrame>=50){waterClock.value=now/1000;lastWaterFrame=now;invalidate()}
  waterFrame=requestAnimationFrame(animateWater);
 }
 function syncWaterAnimation(){
  cancelAnimationFrame(waterFrame);waterFrame=0;
  if(softWater&&shown&&!isolated&&is3D&&!document.hidden&&(waterShown||pondBatch?.mesh.visible))waterFrame=requestAnimationFrame(animateWater);
 }
 document.addEventListener('visibilitychange',syncWaterAnimation);
 const suffix=metadata.revision?'?v='+encodeURIComponent(metadata.revision):'';
 const sync=()=>{
  root.visible=shown&&!isolated;features?.sync(shown&&!isolated&&is3D);plan.visible=Boolean(surface)&&(!is3D||!river);context.visible=is3D&&Boolean(surface);land.visible=is3D;pointCloud&&(pointCloud.visible=is3D&&pointsVisible);
  if(planLand)planLand.visible=!is3D&&Boolean(features?.batches.get('改造陆地')?.mesh.visible);
  if(planPonds)planPonds.visible=!is3D&&Boolean(features?.batches.get('池塘')?.mesh.visible);
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
  syncWaterAnimation();
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
  // Crop both planar and 3D background to the measured TIN. Do not keep
  // rectangular raster fallback outside elevation coverage.
  for(let i=0;i<surface.meshes.length;i++){
   const m=surface.meshes[i],g=new T.BufferGeometry(),[xmin,xmax,ymin,ymax]=m.bounds;
   g.setAttribute('position',new T.Float32BufferAttribute(m.v.flatMap(([x,y])=>[x,metadata.plan_elevation,-y]),3));g.setAttribute('uv',new T.Float32BufferAttribute(m.v.flatMap(([x,y])=>[(x-xmin)/(xmax-xmin),(y-ymin)/(ymax-ymin)]),2));g.setIndex(m.f.flat());plan.children[i].geometry.dispose();plan.children[i].geometry=g;plan.children[i].position.set(0,0,0);
  }
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
  for(let i=0;i<(surface?.meshes.length||0);i++){
   const m=surface.meshes[i],g=plan.children[i].geometry.clone(),[xmin,xmax,ymin,ymax]=m.bounds;
   g.setAttribute('uv',new T.Float32BufferAttribute(m.v.flatMap(([x,y])=>[(x-xmin)/(xmax-xmin),(y-ymin)/(ymax-ymin)]),2));
   context.add(new T.Mesh(g,plan.children[i].material.clone()));
  }
  bedMesh=new T.Mesh(geometryOf(data.bed),new T.MeshLambertMaterial({color:0xa58a69,side:T.DoubleSide}));bedMesh.name='设计河床 −2.80m';root.add(bedMesh);
  flatWaterMaterial=new T.MeshBasicMaterial({color:0x168dd4,transparent:true,opacity:Number(waterOpacity.value)/100,side:T.FrontSide,depthWrite:false});
  const reflection=createRiverReflection(root,scene,data.reference_water_elevation);
  softWaterMaterial=referenceWaterMaterial(waterClock,Number(waterOpacity.value)/100,1,reflection);
  waterMesh=new T.Mesh(geometryOf(data.water),softWaterMaterial);waterMesh.name='蓝绿色水面 · 柔和反光 · 参考水位＋2.20m';waterMesh.renderOrder=2;root.add(waterMesh);
  planWater=new T.Mesh(geometryOf(data.plan_water),new T.MeshBasicMaterial({color:0x168dd4,transparent:true,opacity:Number(waterOpacity.value)/100,side:T.DoubleSide,depthWrite:false}));planWater.renderOrder=2;root.add(planWater);
  river=data;status.title=[...surface?.notes||[],...data.notes].join('\n');
 }catch(error){console.warn('河道模型未加载',error);$('terrainNote').textContent='河床与水体加载失败，可刷新重试。'}
 button.disabled=false;viewButton.disabled=false;opacity.disabled=false;surfaceButton.disabled=!surface;detailButton.disabled=!surface;planButton.disabled=false;waterButton.disabled=!river;waterOpacity.disabled=!river;
 if(river)$('terrainNote').textContent='河床顺接部分为示意；水面采用最高通航水位，非实时水位。';
 button.onclick=()=>{shown=!shown;sync()};
 surfaceButton.onclick=()=>{beforeFrame();is3D=true;shown=true;sync()};planButton.onclick=()=>{beforeFrame();is3D=false;shown=true;sync()};
 bedButton.onclick=()=>{bedShown=!bedShown;sync()};waterButton.onclick=()=>{waterShown=!waterShown;sync()};
 waterOpacity.oninput=()=>{if(river){for(const material of [flatWaterMaterial,softWaterMaterial,planWater.material])material.opacity=Number(waterOpacity.value)/100;invalidate()}};
 waterStyle.onclick=()=>{
  softWater=!softWater;waterStyle.textContent=softWater?'水面：场景反射':'水面：纯色';waterStyle.setAttribute('aria-pressed',String(softWater));
  if(waterMesh)waterMesh.material=softWater?softWaterMaterial:flatWaterMaterial;
  if(pondBatch){const previous=pondBatch.mesh.material,next=softWater?pondSoftMaterial:pondFlatMaterial;next.colorWrite=previous.colorWrite;next.depthWrite=previous.depthWrite;pondBatch.mesh.material=next}
  sync();
 };
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
 try{
  features=await createSiteFeatures({root,camera,controls,invalidate,beforeFrame:()=>{beforeFrame();shown=true;is3D=true;isolated=false;sync()}});
  pondBatch=features.batches.get('池塘');
  if(pondBatch){
   pondFlatMaterial=pondBatch.mesh.material;pondSoftMaterial=referenceWaterMaterial(waterClock,1,.45);pondSoftMaterial.side=T.DoubleSide;pondSoftMaterial.depthWrite=true;pondBatch.mesh.material=pondSoftMaterial;
   document.querySelector('input[data-site-kind="池塘"]')?.addEventListener('change',syncWaterAnimation);
  }
  planLand=new T.Group();planLand.name='平面池塘改陆地';root.add(planLand);
  for(const f of features.data.features.filter(f=>f.kind==='改造陆地')){
   const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(f.v.flatMap(([x,y])=>[x,metadata.plan_elevation+.06,-y]),3));g.setIndex(f.f.flat());
   const mesh=new T.Mesh(g,new T.MeshBasicMaterial({color:0x718665,side:T.DoubleSide}));mesh.renderOrder=3;planLand.add(mesh);
  }
  document.querySelector('input[data-site-kind="改造陆地"]')?.addEventListener('change',sync);
  planPonds=new T.Group();planPonds.name='平面保留池塘';root.add(planPonds);
  for(const f of features.data.features.filter(f=>f.kind==='池塘')){
   const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(f.v.flatMap(([x,y])=>[x,metadata.plan_elevation+.06,-y]),3));g.setIndex(f.f.flat());
   const mesh=new T.Mesh(g,new T.MeshBasicMaterial({color:0x3f91ad,side:T.DoubleSide}));mesh.renderOrder=3;planPonds.add(mesh);
  }
  document.querySelector('input[data-site-kind="池塘"]')?.addEventListener('change',sync);
 }catch(e){console.warn(e);$('terrainNote').textContent+=' 地物模型未加载，可刷新重试。'}
 sync();return {features,root,plan,context,land,planLand,planPonds,metadata,surface,river,bedMesh,waterMesh,planWater,pointCloud,setIsolated(value){isolated=value;sync()},get shown(){return shown},get is3D(){return is3D}};
}
