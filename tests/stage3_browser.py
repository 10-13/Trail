"""Stage 3: draw a real route, break/repair it and edit ports through the UI."""
import json
from playwright.sync_api import sync_playwright, expect
from browser_helpers import snapshot, click_world, projection_point, click_projection

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1000})
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto('http://127.0.0.1:4173');page.wait_for_selector('.catalog-card',state='attached')
    initial=snapshot(page)
    item=lambda id,x:{'id':id,'type':'machine','x':x,'y':1,'z':0,'rotation':0,'width':2,'depth':2,'height':2}
    fixture={'version':2,'wagon':initial['wagon'],'nextId':2,'player':{'x':3,'y':6,'angle':0},'objects':[{'id':'object-1','type':'frame','x':10,'y':1,'z':0,'rotation':0,'width':12,'depth':6,'height':8,'mount':'floor','nextItemId':3,'children':[item('item-1',0),item('item-2',8)]}]}
    page.keyboard.press('Tab');page.locator('#import-file').set_input_files({'name':'pair.json','mimeType':'application/json','buffer':json.dumps(fixture).encode()})
    expect(page.locator('#toast')).to_contain_text('импортирована');page.keyboard.press('Escape')
    click_world(page,16,4);page.keyboard.press('e')
    expect(page.locator('#frame-editor')).to_be_visible()
    frame=lambda:snapshot(page)['objects'][0]
    def choose_pipe(shape='route'):
        page.keyboard.press('Tab')
        page.locator('#editor-pipe-palette [data-pipe-shape]').select_option(shape)
        page.locator('#editor-pipe-palette [data-pipe-choose]').click()
    def draw_route(start,end):
        a=projection_point(page,'xy',frame(),{'x':start,'y':2.5,'z':0})
        b=projection_point(page,'xy',frame(),{'x':end,'y':2.5,'z':0})
        page.mouse.move(*a);page.mouse.down();page.mouse.move(*b,steps=16);page.mouse.up()
    def links(count): expect(page.locator('#editor-network summary')).to_contain_text(f'Связи: {count}')
    choose_pipe();draw_route(2.5,7.5)
    assert len(frame()['pipes'])==6,frame()['pipes']
    links(1)
    page.locator('#editor-network summary').click()
    page.locator('#editor-network [data-network-link]').click()
    expect(page.locator('#editor-network [data-network-link]')).to_have_class('active')
    page.screenshot(path='/workspace/shared/trail-stage3-connected.png')
    page.keyboard.press('Backspace')
    click_projection(page,'xy',frame(),{'x':5.5,'y':2.5,'z':0})
    page.screenshot(path='/workspace/shared/trail-stage3-erase-check.png')
    assert len(frame()['pipes'])==5,frame()['pipes']
    links(0)
    assert page.locator('#editor-network [data-network-link]').count()==0
    choose_pipe();draw_route(3.5,6.5);links(1)
    assert len(frame()['pipes'])==6
    # Moving and rotating a machine must immediately invalidate its old connection.
    page.keyboard.press('Escape')
    click_projection(page,'xy',frame(),{'x':9.2,'y':2.2,'z':0})
    page.keyboard.press('r');links(0)
    for _ in range(3):page.keyboard.press('r')
    links(1)
    page.keyboard.press('m');click_projection(page,'xy',frame(),{'x':10.2,'y':2.2,'z':0})
    assert frame()['children'][1]['x']==9;links(0)
    choose_pipe();draw_route(7.5,8.5);links(1)
    page.keyboard.press('Escape')
    click_projection(page,'xy',frame(),{'x':10.2,'y':2.2,'z':0})
    page.locator('#item-ports summary').click()
    input_row=page.locator('#item-ports [data-port-id="port-1"]')
    input_row.get_by_label('Грань порта').select_option('ny');input_row.get_by_role('button',name='Применить',exact=True).click();links(0)
    input_row=page.locator('#item-ports [data-port-id="port-1"]')
    input_row.get_by_label('Грань порта').select_option('nx');input_row.get_by_role('button',name='Применить',exact=True).click();links(1)
    input_row=page.locator('#item-ports [data-port-id="port-1"]')
    input_row.locator('input').nth(1).fill('.25');input_row.get_by_role('button',name='Применить',exact=True).click();links(0)
    input_row=page.locator('#item-ports [data-port-id="port-1"]')
    input_row.locator('input').nth(1).fill('0');input_row.get_by_role('button',name='Применить',exact=True).click();links(1)
    page.locator('#item-ports').get_by_role('button',name='+ Выход',exact=True).click()
    assert len(frame()['children'][1]['ports'])==3
    page.locator('#item-ports [data-port-id="port-3"]').get_by_role('button',name='Удалить порт').click()
    assert len(frame()['children'][1]['ports'])==2;links(1)
    # A failed stroke into equipment leaves all existing segments unchanged.
    choose_pipe();before=frame()['pipes'];draw_route(7.5,10.5)
    expect(page.locator('#editor-message')).to_contain_text('оборудованием')
    assert frame()['pipes']==before
    page.locator('#close-frame-editor').click()
    # Draw in the wagon at 2 m; changing the layer changes the actual pipe Z.
    page.locator('#pipe-height').fill('2')
    page.keyboard.press('Tab');page.locator('#world-pipe-palette [data-pipe-choose]').click()
    from browser_helpers import world_point
    page.mouse.move(*world_point(page,3.5,6.5));page.mouse.down();page.mouse.move(*world_point(page,6.5,6.5),steps=12);page.mouse.up()
    outside=snapshot(page)['pipes'];assert len(outside)==4 and all(pipe['z']==8 for pipe in outside),outside
    before=snapshot(page)
    page.locator('#pipe-height').fill('1.75');click_world(page,3.5,6.5)
    expect(page.locator('#placement')).to_contain_text('персонаж')
    assert snapshot(page)['pipes']==before['pipes']
    page.keyboard.press('Escape');page.locator('#pipe-height').fill('2.25')
    page.keyboard.press('Tab');page.locator('#world-pipe-palette [data-pipe-shape]').select_option('vertical');page.locator('#world-pipe-palette [data-pipe-choose]').click()
    click_world(page,6.5,6.5)
    assert snapshot(page)['pipes'][-1]['faces']==['nz','pz']
    saved=snapshot(page);assert saved['version']==4
    page.reload();page.wait_for_selector('.catalog-card',state='attached');assert snapshot(page)==saved
    expect(page.locator('#world-network summary')).to_contain_text('Связи: 1')
    page.screenshot(path='/workspace/shared/trail-stage3-wagon.png')
    # Both network properties and the pipe palette remain usable on a phone.
    phone=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True).new_page()
    phone.on('pageerror',lambda error:errors.append(str(error)))
    phone.goto('http://127.0.0.1:4173');phone.wait_for_selector('.catalog-card',state='attached')
    click_world(phone,10,3);phone.locator('#edit-frame').tap()
    phone.locator('#editor-menu-button').tap();phone.locator('#editor-pipe-palette [data-pipe-choose]').tap()
    cur=lambda:snapshot(phone)['objects'][0]
    click_projection(phone,'xy',cur(),{'x':2.5,'y':1.5,'z':0})
    assert len(cur()['pipes'])==1
    phone.locator('#editor-erase').tap();click_projection(phone,'xy',cur(),{'x':2.5,'y':1.5,'z':0})
    assert cur()['pipes']==[]
    assert phone.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors,errors
    browser.close()
    print('PASS: drawn directed connection; highlight; break/repair; moving/rotating equipment and editing port face/offset; add/remove ports; collision rejection; outside height layers and vertical pipe; v4 save/reload; mobile pipe brush/erase; no JS errors')
