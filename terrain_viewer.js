import * as T from 'three/webgpu';

// Terrain retains its survey coordinates and elevations independently of bridge
// mesh display modes, selection indices, and measurements.
export async function createTerrainBasemap({scene,renderer,camera,controls,invalidate,beforeFrame}){
 const $=id=>document.getElementById(id),button=$('terrainToggle'),viewButton=$('terrainView'),opacity=$('terrainOpacity'),status=$('terrainStatus');
 const surfaceButton=$('terrainSurface'),shadeButton=$('terrainShade'),pointButton=$('terrainPoints'),detailButton=$('terrainDetail');
 const response=await fetch('./地形底图配准.json?v=caf711ec5d39');if(!response.ok)throw new Error('配准文件 HTTP '+response.status);
 const metadata=await response.json(),root=new T.Group();root.name='测绘地形';
 const plan=new T.Group(),land=new T.Group();plan.name='0m参考面底图';land.name='实测点插值陆域地表';root.add(plan,land);
 let shown=true,isolated=false,is3D=true,heightColors=true,pointsVisible=false,surface=null,pointCloud=null;
 const suffix=metadata.revision?'?v='+encodeURIComponent(metadata.revision):'';
 const sync=()=>{
  root.visible=shown&&!isolated;land.visible=is3D;pointCloud&&(pointCloud.visible=is3D&&pointsVisible);
  button.textContent=shown?'地形：显示':'地形：隐藏';button.setAttribute('aria-pressed',String(shown));
  surfaceButton.textContent=is3D?'地形：三维':'地形：平面';surfaceButton.setAttribute('aria-pressed',String(is3D));
  shadeButton.textContent=heightColors?'着色：高程':'着色：测绘';shadeButton.setAttribute('aria-pressed',String(heightColors));
  pointButton.textContent=pointsVisible?'测点：显示':'测点：隐藏';pointButton.setAttribute('aria-pressed',String(pointsVisible));
  shadeButton.disabled=!surface||!is3D;pointButton.disabled=!surface||!is3D;
  status.textContent=is3D&&surface?`三维陆域 · ${surface.observations.length}个测点 · 高程${surface.height_range.map(z=>z.toFixed(3)).join('～')}m · 无竖向夸大`:'测绘平面底图 · 0m参考面';
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
   const material=new T.MeshLambertMaterial({color:0xffffff,map:plan.children[i].material.map,vertexColors:heightColors,transparent:true,opacity:Number(opacity.value)/100,depthWrite:false,side:T.DoubleSide});
   const mesh=new T.Mesh(geometry,material);mesh.renderOrder=1;land.add(mesh);
  }
  pointCloud=new T.Points(new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(surface.observations.flatMap(p=>[p.x,p.z+.04,-p.y]),3)),new T.PointsMaterial({color:0xf7b43c,size:4,sizeAttenuation:false}));pointCloud.renderOrder=2;root.add(pointCloud);
  const ambient=new T.AmbientLight(0xffffff,.65),sun=new T.DirectionalLight(0xfff7e5,.65);sun.position.set(-200,400,150);root.add(ambient,sun);
  $('terrainLegend').textContent=`陆域插值高程：${zmin.toFixed(3)}m（蓝绿） → ${zmax.toFixed(3)}m（黄褐）`;
  status.title=surface.notes.join('\n');
 }catch(error){is3D=false;console.warn('三维地形未加载，保留平面底图',error);status.title='三维高程数据加载失败，已显示平面底图，可刷新重试。'}
 button.disabled=false;viewButton.disabled=false;opacity.disabled=false;surfaceButton.disabled=!surface;detailButton.disabled=!surface;
 if(surface)$('terrainNote').textContent='陆域为测点插值；河道保留0m平面底图参考，未建河床。';
 button.onclick=()=>{shown=!shown;sync()};
 surfaceButton.onclick=()=>{is3D=!is3D;sync()};
 shadeButton.onclick=()=>{heightColors=!heightColors;for(const m of land.children){m.material.vertexColors=heightColors;m.material.needsUpdate=true}sync()};
 pointButton.onclick=()=>{pointsVisible=!pointsVisible;sync()};
 opacity.oninput=()=>{for(const m of [...plan.children,...land.children])m.material.opacity=Number(opacity.value)/100;invalidate()};
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
 sync();return {root,plan,land,metadata,surface,pointCloud,setIsolated(value){isolated=value;sync()},get shown(){return shown},get is3D(){return is3D}};
}
