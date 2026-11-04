import * as T from 'three/webgpu';

// The survey is a plan image at a stated reference elevation, independent of
// structural meshes and their ray picking, display modes, and selection ranges.
export async function createTerrainBasemap({scene,renderer,camera,controls,invalidate,beforeFrame}){
 const $=id=>document.getElementById(id),button=$('terrainToggle'),viewButton=$('terrainView'),opacity=$('terrainOpacity'),status=$('terrainStatus');
 const response=await fetch('./地形底图配准.json?v=728d793b20d5');if(!response.ok)throw new Error('配准文件 HTTP '+response.status);
 const metadata=await response.json(),root=new T.Group();root.name='原始测绘地形底图';
 let shown=true,isolated=false;
 const sync=()=>{root.visible=shown&&!isolated;button.textContent=shown?'底图：显示':'底图：隐藏';button.setAttribute('aria-pressed',String(shown));invalidate()};
 const loader=new T.TextureLoader();
 try{
  const tiles=await Promise.all(metadata.tiles.map(async tile=>{
   const texture=await loader.loadAsync('./'+tile.image+(metadata.revision?'?v='+encodeURIComponent(metadata.revision):''));texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=Math.min(4,renderer.getMaxAnisotropy());
   const [xmin,xmax,ymin,ymax]=tile.bounds;
   const geometry=new T.PlaneGeometry(xmax-xmin,ymax-ymin);geometry.rotateX(-Math.PI/2);
   const material=new T.MeshBasicMaterial({map:texture,transparent:true,opacity:Number(opacity.value)/100,side:T.DoubleSide,depthWrite:false});
   const mesh=new T.Mesh(geometry,material);
   // Raster top = positive local Y (the left/north normal). After -90°
   // rotation the plane top is negative world Z = -local Y, matching the model.
   mesh.position.set((xmin+xmax)/2,metadata.plan_elevation,-(ymin+ymax)/2);return mesh;
  }));
  root.add(...tiles);scene.add(root);
 }catch(error){root.traverse(o=>{o.geometry?.dispose();o.material?.map?.dispose();o.material?.dispose()});throw error}
 button.disabled=false;viewButton.disabled=false;opacity.disabled=false;
 status.textContent='八坼大桥地形图 · SI-5坐标配准 · 平面参考面 0m';
 status.title=metadata.notes.join('\n');
 button.onclick=()=>{shown=!shown;sync()};
 opacity.oninput=()=>{for(const m of root.children)m.material.opacity=Number(opacity.value)/100;invalidate()};
 viewButton.onclick=()=>{
  beforeFrame();shown=true;isolated=false;sync();
  const [xmin,xmax,ymin,ymax]=metadata.bounds,span=Math.max((xmax-xmin)*1.12,(ymax-ymin)*innerWidth/innerHeight*1.12);
  camera.left=-span/2;camera.right=span/2;camera.top=span/2*innerHeight/innerWidth;camera.bottom=-camera.top;camera.zoom=1;camera.updateProjectionMatrix();
  const target=new T.Vector3((xmin+xmax)/2,0,-(ymin+ymax)/2);controls.target.copy(target);camera.position.copy(target).add(new T.Vector3(0,700,420));camera.up.set(0,1,0);controls.update();invalidate();
 };
 sync();return {root,metadata,setIsolated(value){isolated=value;sync()},get shown(){return shown}};
}
