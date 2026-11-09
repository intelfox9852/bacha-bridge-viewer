import * as THREE from 'three/webgpu';
import {OrbitControls} from './vendor/OrbitControls.js';
import {TilesRenderer} from '3d-tiles-renderer/three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';

const $=id=>document.getElementById(id);
async function main(){
 const renderer=new THREE.WebGPURenderer({antialias:true});
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);await renderer.init();document.body.append(renderer.domElement);
 const scene=new THREE.Scene();scene.background=new THREE.Color(0x14212c);
 const camera=new THREE.PerspectiveCamera(50,innerWidth/innerHeight,1,100000);
 const controls=new OrbitControls(camera,renderer.domElement);controls.minDistance=10;controls.maxDistance=70000;
 scene.add(new THREE.AmbientLight(0xffffff,2));
 const sun=new THREE.DirectionalLight(0xffffff,1.5);sun.position.set(-1000,3000,1500);scene.add(sun);
 const address=new URLSearchParams(location.search).get('tileset')||'./photogrammetry/tileset.json';
 const response=await fetch(address);if(!response.ok)throw Error(`数据入口读取失败：HTTP ${response.status}`);
 const root=await response.json();
 if(root.asset.extras?.preview){$('datasetNote').textContent='GitHub 轻量预览版：覆盖全范围，细节已简化。完整精度数据约40.8 GB，保留在本地。';$('compare').hidden=true}
 else $('compare').href='./cesium.html?tileset='+encodeURIComponent(new URL(address,location.href).href);
 if(!root.root?.transform)throw Error('验证页需要带地球定位变换矩阵的3D Tiles入口');
 const toLocal=new THREE.Matrix4().makeRotationX(-Math.PI/2).multiply(new THREE.Matrix4().fromArray(root.root.transform).invert());
 const tiles=new TilesRenderer(address);tiles.group.matrixAutoUpdate=false;tiles.group.matrix.copy(toLocal);tiles.group.updateMatrixWorld(true);
 if(root.asset.generatetool?.startsWith('osgb2tiles5')){
  // This dataset uses zero-area empty.b3dm sentinel leaves. Keeping those
  // leaves as high-error renderable tiles prevents replacement LOD traversal.
  tiles.registerPlugin({name:'osgb-empty-leaves',preprocessNode(tile){
   tile.children=tile.children.filter(child=>!(/(?:^|\/)empty\.b3dm$/i.test(child.content?.uri||child.content?.url||'')&&!child.children?.length));
  }});
 }
 const draco=new DRACOLoader(tiles.manager);draco.setDecoderPath('./vendor/oblique-three/examples/jsm/libs/draco/gltf/');draco.setWorkerLimit(4);
 const gltf=new GLTFLoader(tiles.manager);gltf.setDRACOLoader(draco);tiles.manager.addHandler(/\.(gltf|glb)$/i,gltf);
 tiles.setCamera(camera);tiles.setResolutionFromRenderer(camera,renderer);tiles.errorTarget=16;
 tiles.lruCache.maxSize=400;tiles.lruCache.minSize=250;scene.add(tiles.group);
 const box=root.root.boundingVolume.box;
 const center=new THREE.Vector3(box[0],box[2],-box[1]);
 const extent=Math.hypot(box[3],box[7],box[11]);
 let dirty=true,models=0,failures=0,nearCenter=null,autoNear=true,frames=0,lastStatus=0;
 function frame(near=false){
  const target=near&&nearCenter?nearCenter:center;
  const range=near?1800:extent*2.2;
  controls.target.copy(target);camera.position.copy(target).add(new THREE.Vector3(range*.15,range*.65,range*.76));
  controls.update();dirty=true;
 }
 frame(true);
 tiles.addEventListener('load-model',()=>{models++;dirty=true});
 tiles.addEventListener('needs-update',()=>{dirty=true});
 tiles.addEventListener('load-error',event=>{failures++;$('error').hidden=false;$('error').textContent='瓦片读取失败：'+event.url;dirty=true});
 tiles.addEventListener('tile-visibility-change',event=>{
  dirty=true;
  if(!event.visible||!event.scene)return;
  const bounds=new THREE.Box3().setFromObject(event.scene);
  if(bounds.isEmpty())return;
  const radius=bounds.getSize(new THREE.Vector3()).length()/2;
  if(radius<1500){
   const candidate=bounds.getCenter(new THREE.Vector3());
   if(!nearCenter||candidate.distanceTo(center)<nearCenter.distanceTo(center))nearCenter=candidate;
   if(autoNear){autoNear=false;frame(true)}
  }
 });
 controls.addEventListener('change',()=>{dirty=true});
 $('full').onclick=()=>{autoNear=false;frame()};$('near').onclick=()=>{autoNear=!nearCenter;frame(true)};
 $('show').onchange=()=>{tiles.group.visible=$('show').checked;dirty=true};
 $('quality').onchange=()=>{tiles.errorTarget=Number($('quality').value);dirty=true};
 $('menu').onclick=()=>{$('panel').hidden=!$('panel').hidden;$('menu').textContent=$('panel').hidden?'展开菜单':'隐藏菜单'};
 addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);tiles.setResolutionFromRenderer(camera,renderer);dirty=true});
 window.obliqueThree={renderer,scene,camera,controls,tiles,toLocal,frame,get models(){return models},get failures(){return failures},get nearCenter(){return nearCenter}};
 function animate(now){
  requestAnimationFrame(animate);if(document.hidden)return;
  camera.updateMatrixWorld();tiles.group.updateMatrixWorld(true);
  if(tiles.group.visible)tiles.update();
  if(dirty){dirty=false;renderer.render(scene,camera);frames++}
  if(now-lastStatus>1000){$('status').textContent=`${renderer.backend.isWebGPUBackend?'WebGPU':'WebGL2'} · 已载入 ${models} 个模型 · 当前显示 ${tiles.visibleTiles.size} 个瓦片 · 失败 ${failures}`;lastStatus=now}
 }
 requestAnimationFrame(animate);
}
main().catch(error=>{$('error').hidden=false;$('error').textContent=error.message;console.error(error)});
