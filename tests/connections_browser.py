"""Neighbor bridges and three-axis turns remain available in the shelf editor."""
import json
from playwright.sync_api import sync_playwright,expect
from browser_helpers import snapshot,click_world,click_shelf
with sync_playwright()as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    for width,height in [(1440,1000),(390,844)]:
        page=browser.new_page(viewport={'width':width,'height':height},is_mobile=width<500,has_touch=width<500);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto('http://127.0.0.1:4173');page.wait_for_selector('.catalog-card',state='attached');initial=snapshot(page)
        item={'id':'item-1','type':'machine','x':1,'y':1,'z':0,'rotation':0,'width':2,'depth':3,'height':4}
        fixture={'version':2,'wagon':initial['wagon'],'nextId':3,'player':{'x':3,'y':6,'angle':0},'objects':[{'id':f'object-{i+1}','type':'frame','x':x,'y':1,'z':0,'rotation':0,'width':6,'depth':6,'height':8,'mount':'floor','nextItemId':2,'children':[item.copy()]}for i,x in enumerate([10,22])]}
        page.keyboard.press('Tab');page.locator('#import-file').set_input_files({'name':'neighbors.json','mimeType':'application/json','buffer':json.dumps(fixture).encode()});page.keyboard.press('Escape');click_world(page,12,4);page.locator('#edit-frame').click()
        current=lambda:snapshot(page)['objects'][0]
        click_shelf(page,current(),1.4,1.4);page.keyboard.press('Tab');page.locator('#editor-rotation').locator('..').locator('summary').click()
        axis=page.locator('#editor-rotation [data-rotation-axis]');turn=page.locator('#editor-rotation [data-rotate-active]')
        for direction in ['x','y']:
            axis.select_option(direction);turn.click();assert 'orientation'in current()['children'][0]
            for _ in range(3):turn.click()
        assert current()['children'][0].get('orientation')is None
        nearby=page.locator('#neighbor-connections');nearby.locator('summary').click();expect(nearby.locator('summary')).to_contain_text('2')
        nearby.get_by_label('Подключение этого стеллажа').select_option('object-1/item-1/port-2');nearby.get_by_label('Соседнее подключение').select_option('object-2/item-1/port-1');nearby.locator('[data-connect-frames]').click()
        expect(page.locator('#editor-network summary')).to_contain_text('Связи: 1');assert any(16<=pipe['x']<22 for pipe in snapshot(page)['pipes'])
        page.keyboard.press('Escape');page.locator('#close-shelf-inspector').click();click_shelf(page,current(),4.5,2.5)
        page.locator('#shelf-canvas').focus();page.keyboard.press('r');assert set(next(p for p in current()['pipes']if p['x']==4 and p['y']==2)['faces'])=={'nz','pz'}
        for _ in range(3):page.keyboard.press('r')
        page.locator('#close-frame-editor').click();click_world(page,12,4);assert page.locator('#world-rotation option[value=x]').get_attribute('disabled') is not None;assert page.locator('#world-rotation option[value=y]').get_attribute('disabled') is not None;page.locator('#world-rotation [data-rotate-active]').click();assert snapshot(page)['objects'][0]['rotation']==1;assert snapshot(page)['pipes']==[]
        saved=snapshot(page);page.reload();page.wait_for_selector('.catalog-card',state='attached');assert snapshot(page)==saved;assert not errors,errors
    browser.close();print('PASS: desktop/mobile neighbor bridge, X/Y equipment and pipe rotation, upright rack rotation, bridge cleanup and v6 persistence')
