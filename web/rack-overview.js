import { EQUIPMENT, dimensions } from './geometry.js';
import { rackView } from './rack-view.js';
import { shelvesOf, shelfForItem } from './shelves.js';
import { DIRECTIONS } from './logistics.js';
import { RESOURCES, pipeTokens } from './simulation.js';
import { el } from './ui.js';

// Exploded-view geometry is presentation only: no construction coordinates change.
export function rackOverviewLayout(frame,width,height,expansion={}) {
  const size=rackView(frame).size,shelves=shelvesOf(frame),room=Math.max(60,width-150);
  const minimumFront=Math.min(120,room*.6),unit=Math.min(42,room/(size.width+size.depth*.45),(room-minimumFront)/(size.depth*.45));
  const frontWidth=Math.max(minimumFront,size.width*unit),dx=size.depth*unit*.45,dy=dx*.5;
  const base=shelves.map(s=>Math.max(28,s.height*unit)),extra=Math.min(110,Math.max(64,height*.17));
  const fit=Math.min(1,Math.max(60,height-80-dy)/(base.reduce((a,b)=>a+b,0)+extra*2));
  const baseHeights=base.map(h=>h*fit),maxExtra=extra*fit;
  const reserved=baseHeights.reduce((a,b)=>a+b,0)+dy;
  const x=(width-frontWidth-dx-110)/2+dx,y=(height+reserved)/2;
  let level=0;
  const floors=shelves.map((s,i)=>{const h=baseHeights[i]+(expansion[s.id]||0)*maxExtra;const floor={...s,heightVoxels:s.height,index:i,base:baseHeights[i],height:h,bottom:y-level,top:y-level-h,x,width:frontWidth};level+=h;return floor;});
  function elevation(z){
    const i=shelves.findIndex(s=>z<s.z+s.height),index=i<0?shelves.length-1:Math.max(0,i),floor=floors[index],s=shelves[index];
    return y-floor.bottom+(z-s.z)/s.height*floor.height;
  }
  const project=(px,py,pz)=>({x:x+px/size.width*frontWidth-py/size.depth*dx,y:y-elevation(pz)-py/size.depth*dy});
  return {x,y,dx,dy,frontWidth,unit,fit,maxExtra,floors,project,size};
}
function shelfOutline(layout,floor){
  const {dx,dy}=layout,x=floor.x,y=floor.top,w=floor.width,b=floor.bottom;
  return [[x-dx,y-dy],[x+w-dx,y-dy],[x+w,y],[x+w,b],[x,b],[x-dx,b-dy]];
}
function inPolygon(points,x,y){let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const [ax,ay]=points[i],[bx,by]=points[j];if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;}return inside;}
export function rackShelfAt(layout,x,y){
  const front=layout.floors.find(f=>x>=f.x&&x<=f.x+f.width&&y>=f.top&&y<=f.bottom);if(front)return front.id;
  return [...layout.floors].reverse().find(f=>inPolygon(shelfOutline(layout,f),x,y))?.id||null;
}

export function createRackOverview(host,{getFrame,getState,getSelected,onChoose}){
  const canvas=el('canvas');canvas.id='rack-overview-canvas';canvas.setAttribute('aria-label','Объёмный вид стеллажа сбоку');
  const hits=el('div','rack-overview-hits');
  host.append(canvas,hits);const ctx=canvas.getContext('2d');
  let hovered=null,weights={},buttons=new Map(),layout=null,animation=null,previous=0,active=false;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  function choose(id){setHover(null);onChoose(id);}
  function syncButtons(){
    const frame=getFrame();if(!frame)return;const shelves=shelvesOf(frame),valid=new Set(shelves.map(s=>s.id));
    for(const [id,button]of buttons)if(!valid.has(id)){button.remove();buttons.delete(id);delete weights[id];}
    for(const [i,shelf]of [...shelves.entries()].reverse()){
      let button=buttons.get(shelf.id);if(!button){button=el('button','rack-shelf-hit');button.type='button';button.dataset.rackShelf=shelf.id;button.onclick=()=>choose(shelf.id);button.onfocus=()=>setHover(shelf.id);button.onblur=event=>{if(!hits.contains(event.relatedTarget))setHover(null);};
        button.onpointerdown=event=>{if(event.pointerType==='touch')setHover(shelf.id);};buttons.set(shelf.id,button);hits.append(button);}
      const count=frame.children.filter(o=>shelfForItem(frame,o)?.id===shelf.id).length;
      button.setAttribute('aria-label',`Полка ${i+1}, высота ${(shelf.height/4).toLocaleString('ru-RU')} м, блоков ${count}`);button.setAttribute('aria-pressed',shelf.id===getSelected());
    }
  }
  function setHover(id){if(hovered===id)return;hovered=id;canvas.style.cursor=id?'pointer':'default';host.dataset.hoveredShelf=id||'';requestDraw();}
  host.addEventListener('pointermove',event=>{
    if(event.pointerType==='touch'||!layout)return;const rect=canvas.getBoundingClientRect();setHover(rackShelfAt(layout,event.clientX-rect.left,event.clientY-rect.top));
  });
  host.addEventListener('pointerleave',()=>setHover(null));
  canvas.addEventListener('click',event=>{if(!layout)return;const rect=canvas.getBoundingClientRect(),id=rackShelfAt(layout,event.clientX-rect.left,event.clientY-rect.top);if(id)choose(id);});
  hits.addEventListener('keydown',event=>{
    if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();const shelves=shelvesOf(getFrame()),ids=shelves.map(s=>s.id),index=ids.indexOf(document.activeElement.dataset.rackShelf);
    const next=event.key==='Home'?ids.at(-1):event.key==='End'?ids[0]:ids[Math.max(0,Math.min(ids.length-1,index+(event.key==='ArrowUp'?1:-1)))];buttons.get(next)?.focus();
  });
  window.addEventListener('blur',()=>setHover(null));
  function requestDraw(){if(active&&animation===null)animation=requestAnimationFrame(render);}
  function polygon(points,fill,stroke='#70858a',lineWidth=1){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=lineWidth;ctx.stroke();}}
  function line(a,b,color='#829397',width=2){ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
  function drawBox(item,floor){
    const {size,frontWidth,dx,dy}=layout,d=dimensions(item),x=item.x/size.width*frontWidth,depth=item.y/size.depth,z=(item.z-floor.z)/floor.heightVoxels;
    const base={x:layout.x+x-depth*dx,y:floor.bottom-z*floor.base-depth*dy};
    const w=d.width/size.width*frontWidth,back={x:-d.depth/size.depth*dx,y:-d.depth/size.depth*dy},h=d.height/floor.heightVoxels*floor.base;
    const a=base,b={x:a.x+w,y:a.y},c={x:b.x+back.x,y:b.y+back.y},e={x:a.x+back.x,y:a.y+back.y};
    const top=p=>({x:p.x,y:p.y-h}),color=EQUIPMENT[item.type]?.color||'#93b4c2';
    polygon([a,e,top(e),top(a)],`${color}16`,`${color}99`);polygon([a,b,top(b),top(a)],`${color}24`,`${color}aa`);polygon([top(a),top(b),top(c),top(e)],`${color}36`,`${color}bb`);
    if(w>25&&h>18){ctx.fillStyle=color;ctx.font='12px monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(item.type==='filter'?'▽':item.type==='centrifuge'?'⊕':item.type==='tank'?'○':'□',a.x+w/2,a.y-h/2);}
  }
  function render(time){
    animation=null;if(!active||!getFrame())return;const frame=getFrame(),shelves=shelvesOf(frame),rect=host.getBoundingClientRect();if(!rect.width||!rect.height)return;
    const dt=previous?Math.min(50,time-previous):16;previous=time;let moving=false;
    for(const s of shelves){const target=s.id===hovered?1:0,current=weights[s.id]||0,next=reduced.matches?target:current+(target-current)*(1-Math.exp(-dt/60));weights[s.id]=Math.abs(next-target)<.002?target:next;if(weights[s.id]!==target)moving=true;}
    const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle='#111c23';ctx.fillRect(0,0,rect.width,rect.height);ctx.fillStyle='#34454d66';for(let x=16;x<rect.width;x+=26)for(let y=16;y<rect.height;y+=26){ctx.beginPath();ctx.arc(x,y,.8,0,Math.PI*2);ctx.fill();}
    ctx.fillStyle='#82959d';ctx.font='11px monospace';ctx.textAlign='left';ctx.textBaseline='top';ctx.fillText('← Перед поезда',24,18);
    layout=rackOverviewLayout(frame,rect.width,Math.max(120,rect.height-30),weights);
    const {project:p,size}=layout,top=size.height,projection=rackView(frame);
    // Rear posts, then floors and contents, then the front posts.
    line(p(0,size.depth,0),p(0,size.depth,top));line(p(size.width,size.depth,0),p(size.width,size.depth,top));
    for(const floor of layout.floors){
      const activeShelf=floor.id===hovered,selected=floor.id===getSelected(),z=floor.z,color=activeShelf?'#e8b76b':selected?'#93b4c2':'#75898e';
      polygon([p(0,0,z),p(size.width,0,z),p(size.width,size.depth,z),p(0,size.depth,z)],activeShelf?'#93d7cf13':'#26343c55',color,activeShelf?2.2:1.5);
      const objects=frame.children.filter(o=>shelfForItem(frame,o)?.id===floor.id).map(projection.box).sort((a,b)=>b.y-a.y||a.x-b.x);
      for(const item of objects)drawBox(item,floor);
      for(const pipe of frame.pipes.filter(pipe=>pipe.z>=z&&pipe.z<z+floor.heightVoxels).map(projection.pipe)){
        const center=p(pipe.x+.5,pipe.y+.5,pipe.z+.14);for(const face of pipe.faces){const v=DIRECTIONS[face];line(center,p(pipe.x+.5+v[0]*.5,pipe.y+.5+v[1]*.5,Math.max(0,Math.min(size.height,pipe.z+.14+v[2]*.5))),'#77c8bc99',1.6);}
        const contents=pipeTokens(getState(),pipe.id);for(const [i,token]of contents.entries()){ctx.fillStyle=RESOURCES[token.resource].color;ctx.beginPath();ctx.arc(center.x+(i%2?2:-2),center.y+(i<2?-2:2),1.8,0,Math.PI*2);ctx.fill();}
      }
      const labelX=layout.x+layout.frontWidth+17,mid=(floor.top+floor.bottom)/2;
      if(activeShelf){line({x:labelX,y:floor.top+5},{x:labelX,y:floor.bottom-5},color,1.5);line({x:labelX-4,y:floor.top+5},{x:labelX,y:floor.top+5},color,1.5);line({x:labelX-4,y:floor.bottom-5},{x:labelX,y:floor.bottom-5},color,1.5);}
      ctx.fillStyle=color;ctx.textAlign='left';ctx.textBaseline='middle';ctx.font='12px monospace';ctx.fillText(`Полка ${floor.index+1}`,labelX+9,mid-8);ctx.fillStyle='#82959d';ctx.font='10px monospace';ctx.fillText(`${(floor.heightVoxels/4).toLocaleString('ru-RU')} м · ${objects.length} бл.`,labelX+9,mid+9);
      const button=buttons.get(floor.id);if(button){Object.assign(button.style,{left:`${floor.x}px`,top:`${floor.top}px`,width:`${floor.width}px`,height:`${floor.height}px`});button.dataset.expansion=weights[floor.id].toFixed(3);button.setAttribute('aria-pressed',selected);}
    }
    polygon([p(0,0,top),p(size.width,0,top),p(size.width,size.depth,top),p(0,size.depth,top)],null,'#829397',2);
    line(p(0,0,0),p(0,0,top),'#a0afb2',2.5);line(p(size.width,0,0),p(size.width,0,top),'#a0afb2',2.5);
    if(moving)requestDraw();
  }
  new ResizeObserver(()=>{previous=0;requestDraw();}).observe(host);
  reduced.addEventListener('change',()=>requestDraw());
  return{
    setVisible(visible){active=visible;host.hidden=!visible;if(!visible){hovered=null;weights={};previous=0;host.dataset.hoveredShelf='';if(animation!==null){cancelAnimationFrame(animation);animation=null;}}else{syncButtons();requestDraw();}},
    focusShelf(id){buttons.get(id)?.focus();},
    refresh(){if(active){syncButtons();requestDraw();}},
    reset(){hovered=null;weights={};previous=0;syncButtons();requestDraw();}
  };
}
