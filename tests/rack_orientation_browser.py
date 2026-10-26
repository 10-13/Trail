"""Wagon-aligned rendering and editing must agree for every rack yaw."""
from playwright.sync_api import sync_playwright,expect
from browser_helpers import snapshot,click_world,click_shelf,shelf_point,shelf_geometry

FIXTURE="""async ({rotation,explicit})=>{
 const c=await import('/core.js'),s=await import('/shelves.js');
 const state=c.createState(false),orientation=[[1,2,3],[2,-1,3],[-1,-2,3],[-2,1,3]][rotation];
 const error=c.putObject(state,{type:'frame',x:10,y:1,z:0,width:10,depth:6,height:8,rotation,mount:'floor',shelves:s.makeShelves([4,4]),children:[],...(explicit?{orientation}:{})});if(error)throw Error(error);
 const frame=state.objects[0];
 for(const result of [c.putEquipment(state,frame.id,{type:'machine',x:1,y:1,z:0,width:2,depth:1,height:2,rotation:0,shelfId:'shelf-1'}),c.putPipe(state,{x:7,y:4,z:0,faces:['nx','px']},frame.id)])if(result)throw Error(result);
 localStorage.setItem('trail.stage1.layout.v1',c.serialize(state));
}"""

def cyan_pixel(page,canvas,x,y):
    # Drawn block faces differ from the neutral background/grid in their blue tint.
    return page.locator(canvas).evaluate("""(c,p)=>{const r=c.getBoundingClientRect(),s=c.width/r.width,d=c.getContext('2d').getImageData(Math.round(p.x*s),Math.round(p.y*s),1,1).data;return d[1]>45&&d[2]>d[0]+12}""",{'x':x,'y':y})

def run(page,rotation,explicit=False):
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://127.0.0.1:4173');page.wait_for_selector('.catalog-card',state='attached');page.evaluate(FIXTURE,{'rotation':rotation,'explicit':explicit});page.reload();page.wait_for_selector('.catalog-card',state='attached')
    before=snapshot(page);frame=before['objects'][0]
    click_world(page,12,3);page.locator('#edit-frame').click();expect(page.locator('#rack-overview')).to_be_visible()
    # Independently expected world-relative AABBs for the asymmetric block.
    x,y,w,d=[(1,1,2,1),(4,1,1,2),(7,4,2,1),(1,7,1,2)][rotation]
    geom=page.evaluate("""async f=>{const {rackOverviewLayout}=await import('/rack-overview.js'),r=document.getElementById('rack-overview').getBoundingClientRect(),l=rackOverviewLayout(f,r.width,Math.max(120,r.height-30));return {x:l.x,bottom:l.floors[0].bottom,base:l.floors[0].base,width:l.frontWidth,dx:l.dx,dy:l.dy,size:l.size}}""",frame)
    bx=geom['x']+(x+w/2)/geom['size']['width']*geom['width']-y/geom['size']['depth']*geom['dx']
    by=geom['bottom']-geom['base']/4-y/geom['size']['depth']*geom['dy']
    assert cyan_pixel(page,'#rack-overview-canvas',bx,by),(rotation,'overview block mirrored')
    assert snapshot(page)==before,'Opening an editor must not rotate the saved construction'
    page.locator('[data-rack-shelf=shelf-1]').click();page.mouse.move(5,5)
    g=shelf_geometry(page,frame)
    assert cyan_pixel(page,'#shelf-canvas',g['left']-page.locator('#shelf-canvas').bounding_box()['x']+(x+.18)*g['scale'],g['top']-page.locator('#shelf-canvas').bounding_box()['y']+(y+.18)*g['scale']),(rotation,'plan block mirrored')
    # Click the visible box, drag it one local cell, and erase at the new location.
    click_shelf(page,frame,2,1.5);expect(page.locator('#shelf-inspector')).to_be_visible()
    page.locator('#close-shelf-inspector').click()
    page.mouse.move(*shelf_point(page,frame,2,1.5));page.mouse.down();page.mouse.move(*shelf_point(page,frame,3,1.5),steps=6);page.mouse.up()
    moved=snapshot(page)['objects'][0]['children'][0];assert(moved['x'],moved['y'])==(2,1),(rotation,moved)
    page.locator('#close-shelf-inspector').click();page.keyboard.press('Backspace');click_shelf(page,frame,3,1.5);assert snapshot(page)['objects'][0]['children']==[];page.keyboard.press('Escape')
    # Asymmetric footprint placement and picking the transformed pipe use inverse coordinates.
    page.keyboard.press('Tab');page.locator('#editor-menu summary',has_text='Размер нового блока').click();page.locator('#brush-width').fill('.75');page.locator('#brush-depth').fill('.25');page.locator('[data-equipment-type=machine]').click();click_shelf(page,frame,4.6,2.6);page.keyboard.press('Escape')
    placed=snapshot(page)['objects'][0]['children'][0];assert(placed['x'],placed['y'],placed['width'],placed['depth'])==(3,2,3,1),(rotation,placed)
    click_shelf(page,frame,7.5,4.5);expect(page.locator('#editor-pipe-inspector')).to_be_visible();page.locator('#close-shelf-inspector').click();page.keyboard.press('Backspace');click_shelf(page,frame,7.5,4.5);assert snapshot(page)['objects'][0]['pipes']==[];page.keyboard.press('Escape')
    # Wheel zoom keeps the point under the pointer; panning still follows the mouse.
    page.locator('#shelf-zoom-out').click();before_zoom=shelf_point(page,frame,4.5,2.5);page.mouse.move(*before_zoom);page.mouse.wheel(0,-120);page.wait_for_timeout(60);after_zoom=shelf_point(page,frame,4.5,2.5)
    assert max(abs(a-b)for a,b in zip(before_zoom,after_zoom))<3,(rotation,before_zoom,after_zoom)
    page.locator('#shelf-fit').click();start=shelf_point(page,frame,8.5,5.5);page.mouse.move(*start);page.mouse.down(button='middle');page.mouse.move(start[0]+30,start[1]+20,steps=4);page.mouse.up(button='middle')
    after_pan=shelf_point(page,frame,8.5,5.5);assert abs(after_pan[0]-start[0]-30)<3 and abs(after_pan[1]-start[1]-20)<3
    page.locator('#rack-view-overview').click();page.locator('[data-rack-shelf=shelf-2]').click();expect(page.locator('#shelf-select')).to_have_value('shelf-2')
    assert not errors,errors

with sync_playwright()as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    for rotation in range(4):
        page=browser.new_page(viewport={'width':1440,'height':1000});run(page,rotation,explicit=rotation==3);page.close()
    page=browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True);run(page,1);page.close()
    browser.close();print('PASS: train-aligned overview/plan for all yaws and phone, immutable opening, asymmetric boxes, drag, brush, pipe picking/erasing, zoom and pan')
