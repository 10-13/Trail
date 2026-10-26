import { dimensions, localSize } from './geometry.js';

export function makeShelves(heights) {
  let z=0;
  return heights.map((height,i)=>{const shelf={id:`shelf-${i+1}`,z,height};z+=height;return shelf;});
}
export function shelvesOf(frame) { return frame.shelves===undefined?makeShelves([localSize(frame).height]):frame.shelves; }
export function shelvesError(frame) {
  const shelves=shelvesOf(frame);if(!Array.isArray(shelves)||!shelves.length||shelves.length>10)return 'В стеллаже должно быть от 1 до 10 полок';
  let z=0;const ids=new Set();
  for(const shelf of shelves){
    if(!shelf||!/^shelf-[1-9]\d*$/.test(shelf.id)||ids.has(shelf.id)||!Number.isInteger(shelf.height)||shelf.height<1||shelf.z!==z)return 'Некорректная разметка полок';
    z+=shelf.height;ids.add(shelf.id);
  }
  return z===localSize(frame).height?'':'Высоты полок должны заполнять стеллаж';
}
export function shelfForItem(frame,item) {
  return shelvesOf(frame).find(s=>item.shelfId?s.id===item.shelfId:item.z>=s.z&&item.z+dimensions(item).height<=s.z+s.height);
}
export function shelfPlacementError(frame,item) {
  if(item.shelfId!==undefined&&(typeof item.shelfId!=='string'||!/^shelf-[1-9]\d*$/.test(item.shelfId)))return 'Некорректная полка блока';
  const shelf=shelfForItem(frame,item);if(!shelf)return 'Блок не помещается по высоте полки';
  if(item.shelfId&&item.z!==shelf.z)return 'Блок должен стоять на своей полке';
  return item.z+dimensions(item).height<=shelf.z+shelf.height?'':'Блок выше доступной высоты полки';
}
export function shelfUsage(frame,shelf,pipes=[]) {
  const size=localSize(frame),cells=new Set();
  for(const item of frame.children||[]){const d=dimensions(item);if(item.z>=shelf.z+shelf.height||item.z+d.height<=shelf.z)continue;
    for(let x=item.x;x<item.x+d.width;x++)for(let y=item.y;y<item.y+d.depth;y++)cells.add(`${x},${y}`);
  }
  for(const p of pipes)if(p.z>=shelf.z&&p.z<shelf.z+shelf.height)cells.add(`${p.x},${p.y}`);
  return {used:cells.size,total:size.width*size.depth,free:size.width*size.depth-cells.size};
}
