"""Frame acceptance: shared brush controls, draggable cut planes and adaptive layout."""
import json
from playwright.sync_api import sync_playwright, expect
from browser_helpers import snapshot, click_world, choose_equipment, click_projection, projection_point, view_geometry, drag_slice, check_editor_layout

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width':1440,'height':1000})
    errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://127.0.0.1:4173'); page.wait_for_selector('.catalog-card',state='attached')
    page.keyboard.press('Tab')
    for key, value in [('width',2),('depth',1.5),('height',2)]: page.locator(f'#new-frame-{key}').fill(str(value))
    page.locator('[data-type="frame"]').click(); click_world(page,12.25,9.25)
    page.keyboard.press('Escape'); page.keyboard.press('e')
    expect(page.locator('#frame-editor')).to_be_visible()
    current=lambda: snapshot(page)['objects'][-1]
    check_editor_layout(page,current())
    before_player=snapshot(page)['player']
    page.keyboard.down('w'); page.wait_for_timeout(150); page.keyboard.up('w')
    assert snapshot(page)['player']==before_player
    choose_equipment(page)
    click_projection(page,'xy',current(),{'x':1.2,'y':1.2,'z':0})
    click_projection(page,'xy',current(),{'x':4.2,'y':1.2,'z':0})
    assert len(current()['children'])==2
    # Holding the brush adds blocks in successive free positions in a frame too.
    start=projection_point(page,'xy',current(),{'x':1.2,'y':4.2,'z':0})
    end=projection_point(page,'xy',current(),{'x':4.2,'y':4.2,'z':0})
    page.mouse.move(*start); page.mouse.down(); page.mouse.move(*end,steps=10); page.mouse.up()
    assert len(current()['children'])==4,current()['children']
    page.keyboard.press('Backspace'); assert len(current()['children'])==4
    click_projection(page,'xy',current(),{'x':1.2,'y':1.2,'z':0})
    click_projection(page,'xy',current(),{'x':4.2,'y':1.2,'z':0})
    assert len(current()['children'])==2
    # A dragged line in one view changes the hidden coordinate of painting in another.
    choose_equipment(page)
    drag_slice(page,'xz',current(),1,4)
    click_projection(page,'xy',current(),{'x':1.2,'y':1.2,'z':4})
    assert current()['children'][-1]['z']==4,current()['children']
    drag_slice(page,'xz',current(),1,1)
    click_projection(page,'xy',current(),{'x':4.2,'y':1.2,'z':1})
    assert current()['children'][-1]['z']==1
    drag_slice(page,'xy',current(),1,2)
    click_projection(page,'xz',current(),{'x':1.2,'y':2,'z':5.2})
    assert [current()['children'][-1][k] for k in ['x','y','z']]==[0,2,4]
    drag_slice(page,'xy',current(),0,5)
    click_projection(page,'yz',current(),{'x':5,'y':1.2,'z':5.2})
    assert [current()['children'][-1][k] for k in ['x','y','z']]==[5,0,4]
    # An invalid overlap leaves all geometry intact.
    before=current()['children']
    click_projection(page,'yz',current(),{'x':5,'y':1.2,'z':5.2})
    expect(page.locator('#editor-message')).to_contain_text('пересекается')
    assert current()['children']==before
    page.keyboard.press('Escape')
    click_projection(page,'yz',current(),{'x':5,'y':1.2,'z':5.2})
    page.locator('#item-depth').fill('.75'); page.locator('#item-height').fill('.75')
    page.locator('#item-form button[type=submit]').click(); page.keyboard.press('r')
    assert current()['children'][-1]['rotation']==1
    check_editor_layout(page,current())
    page.screenshot(path='/workspace/shared/trail-editor-brush-final.png')
    saved=snapshot(page); page.locator('#close-frame-editor').click()
    expect(page.locator('#viewport')).to_be_visible(); assert snapshot(page)==saved
    page.reload(); page.wait_for_selector('.catalog-card',state='attached'); assert snapshot(page)==saved
    # A frame wider across the wagon puts the top view under the right elevation.
    fixture={'version':2,'wagon':saved['wagon'],'nextId':2,'player':{'x':3,'y':6,'angle':0},'objects':[{'id':'object-1','type':'frame','x':8,'y':1,'z':0,'rotation':0,'width':4,'depth':8,'height':8,'mount':'floor','nextItemId':2,'children':[{'id':'item-1','type':'machine','x':1,'y':1,'z':1,'rotation':0,'width':1,'depth':1,'height':1}]}]}
    page.keyboard.press('Tab')
    page.locator('#import-file').set_input_files({'name':'wide.json','mimeType':'application/json','buffer':json.dumps(fixture).encode()})
    expect(page.locator('#toast')).to_contain_text('импортирована')
    page.keyboard.press('Escape'); click_world(page,10,5); page.keyboard.press('e')
    current=lambda: snapshot(page)['objects'][0]
    check_editor_layout(page,current())
    drag_slice(page,'xz',current(),1,1)
    child=lambda:current()['children'][0]
    def drag_item(plane,a,b):
        item=child(); g=view_geometry(page,plane,current())
        point={axis:item[axis]+.5 for axis in ['x','y','z']}
        sx,sy=projection_point(page,plane,current(),point)
        page.mouse.move(sx,sy); page.mouse.down(); page.mouse.move(sx+a*g['scale'],sy+b*g['scale']*(-1 if g['flip'] else 1),steps=5); page.mouse.up()
    # In the transposed top view, the displayed coordinates are across/along.
    drag_item('xy',1,1); assert [child()[k] for k in ['x','y','z']]==[2,2,1],child()
    drag_item('xz',1,2); assert [child()[k] for k in ['x','y','z']]==[3,2,3],child()
    drag_item('yz',1,1); assert [child()[k] for k in ['x','y','z']]==[3,3,4],child()
    before=child(); drag_item('xy',10,10)
    expect(page.locator('#editor-message')).to_contain_text('границы'); assert child()==before
    # Backspace inside a numeric field edits text rather than arming deletion.
    page.locator('#item-height').focus(); page.keyboard.press('Backspace')
    expect(page.locator('#editor-erase')).to_have_attribute('aria-pressed','false')
    page.locator('#item-height').fill('.25')
    # Parent settings remain available inside Tab, without a permanent top section.
    page.keyboard.press('Tab'); page.locator('#editor-frame-options summary').click()
    page.locator('#edit-frame-height').fill('.75'); page.locator('#frame-form button[type=submit]').click()
    expect(page.locator('#editor-message')).to_contain_text('границы'); assert current()['height']==8
    page.locator('#edit-frame-height').fill('2.25'); page.locator('#frame-form button[type=submit]').click()
    assert current()['height']==9
    page.keyboard.press('Escape'); page.keyboard.press('Backspace')
    click_projection(page,'yz',current(),{'x':3,'y':3.5,'z':4.5})
    assert current()['children']==[]
    page.keyboard.press('Tab')
    page.locator('#edit-frame-height').fill('.5'); page.locator('#edit-frame-mount').select_option('ceiling')
    page.locator('#frame-form button[type=submit]').click()
    assert current()['z']==8 and current()['mount']=='ceiling'
    page.locator('#close-frame-editor').click()
    saved=snapshot(page); page.reload(); page.wait_for_selector('.catalog-card',state='attached'); assert snapshot(page)==saved
    # Mobile users can use the same palette and eraser via the compact buttons.
    phone=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True).new_page()
    phone.on('pageerror',lambda e:errors.append(str(e)))
    phone.goto('http://127.0.0.1:4173'); phone.wait_for_selector('.catalog-card',state='attached')
    click_world(phone,10,3); phone.locator('#edit-frame').tap()
    cur=lambda:snapshot(phone)['objects'][0]
    check_editor_layout(phone,cur())
    phone.locator('#editor-menu-button').tap(); phone.locator('[data-equipment-type="machine"]').tap()
    click_projection(phone,'xy',cur(),{'x':1.2,'y':1.2,'z':0}); assert len(cur()['children'])==1
    phone.locator('#editor-erase').tap(); click_projection(phone,'xy',cur(),{'x':1.2,'y':1.2,'z':0})
    assert cur()['children']==[]
    phone.screenshot(path='/workspace/shared/trail-editor-mobile-final.png')
    phone.locator('#close-frame-editor').tap(); expect(phone.locator('#frame-editor')).to_be_hidden()
    assert not errors,errors
    browser.close()
    print('PASS: Tab paint and Backspace eraser in all views; repeated/drag placement; three draggable cut coordinates; floor markings; adaptive aligned layout; three-plane moves; bounds/overlap/resize safety; save/load; native input editing; mobile controls; no JS errors')
