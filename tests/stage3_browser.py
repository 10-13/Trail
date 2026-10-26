"""Shelf pipe routes, ports and the directed connection graph."""
import json
from playwright.sync_api import sync_playwright,expect
from browser_helpers import snapshot,click_world,click_shelf,shelf_point
with sync_playwright()as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    for width,height in [(1440,1000),(390,844)]:
        page=browser.new_page(viewport={'width':width,'height':height},is_mobile=width<500,has_touch=width<500);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto('http://127.0.0.1:4173');page.wait_for_selector('.catalog-card',state='attached');initial=snapshot(page)
        item=lambda id,x:{'id':id,'type':'machine','x':x,'y':1,'z':0,'rotation':0,'width':2,'depth':2,'height':2}
        fixture={'version':2,'wagon':initial['wagon'],'nextId':2,'player':{'x':3,'y':6,'angle':0},'objects':[{'id':'object-1','type':'frame','x':10,'y':1,'z':0,'rotation':0,'width':12,'depth':6,'height':8,'mount':'floor','nextItemId':3,'children':[item('item-1',0),item('item-2',8)]}]}
        page.keyboard.press('Tab');page.locator('#import-file').set_input_files({'name':'legacy.json','mimeType':'application/json','buffer':json.dumps(fixture).encode()});page.keyboard.press('Escape');click_world(page,16,4);page.locator('#edit-frame').click()
        current=lambda:snapshot(page)['objects'][0]
        def choose():page.keyboard.press('Tab');page.locator('#editor-pipe-palette [data-pipe-choose]').click()
        def route(a,b):
            page.mouse.move(*shelf_point(page,current(),a,2.5));page.mouse.down();page.mouse.move(*shelf_point(page,current(),b,2.5),steps=10);page.mouse.up()
        choose();route(2.5,7.5);assert len(current()['pipes'])==6
        page.keyboard.press('Escape');page.keyboard.press('Tab');page.locator('#editor-network summary').click();expect(page.locator('#editor-network summary')).to_contain_text('Связи: 1');page.locator('#editor-network [data-network-link]').click();expect(page.locator('#editor-network [data-network-link]')).to_have_class('active');page.keyboard.press('Escape')
        page.keyboard.press('Backspace');click_shelf(page,current(),5.5,2.5);assert len(current()['pipes'])==5
        choose();route(3.5,6.5);assert len(current()['pipes'])==6
        page.keyboard.press('Escape');click_shelf(page,current(),9.2,2.2);page.locator('#shelf-canvas').focus();page.keyboard.press('r')
        assert current()['children'][1]['rotation']==1
        for _ in range(3):page.keyboard.press('r')
        page.locator('#item-ports summary').click();row=page.locator('#item-ports [data-port-id="port-1"]');row.get_by_label('Грань порта').select_option('ny');row.get_by_role('button',name='Применить',exact=True).click()
        row=page.locator('#item-ports [data-port-id="port-1"]');row.get_by_label('Грань порта').select_option('nx');row.get_by_role('button',name='Применить',exact=True).click()
        page.locator('#close-shelf-inspector').click();choose();before=current()['pipes'];route(7.5,10.5);expect(page.locator('#editor-message')).to_contain_text('оборудованием');assert current()['pipes']==before
        saved=snapshot(page);page.reload();page.wait_for_selector('.catalog-card',state='attached');assert snapshot(page)==saved
        assert not errors,errors
    browser.close();print('PASS: desktop/mobile shelf routes, highlight, break/repair, rotation, port editing, atomic collision refusal, legacy import and v6 save')
