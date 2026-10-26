"""Full-screen shelf editor: native construction, partitions and pipe risers."""
import json
from playwright.sync_api import sync_playwright, expect
from browser_helpers import snapshot,click_world,click_shelf,shelf_point

def run(page):
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://127.0.0.1:4173');page.wait_for_selector('.catalog-card',state='attached')
    click_world(page,10,3);page.locator('#edit-frame').click()
    expect(page.locator('#frame-editor')).to_be_visible()
    assert page.locator('[data-plane]').count()==0
    current=lambda:snapshot(page)['objects'][0]
    assert len(current()['shelves'])==2
    def choose():page.keyboard.press('Tab');page.locator('[data-equipment-type="machine"]').click()
    choose();click_shelf(page,current(),1.2,1.2);click_shelf(page,current(),4.2,1.2)
    assert len(current()['children'])==2
    assert all(item['z']==0 and item['shelfId']=='shelf-1'for item in current()['children'])
    page.locator('#shelf-select').select_option('shelf-2');click_shelf(page,current(),1.2,1.2)
    assert len(current()['children'])==3
    assert current()['children'][-1]['z']==4
    page.keyboard.press('Escape');click_shelf(page,current(),.8,.8)
    expect(page.locator('#item-form')).to_be_visible()
    page.locator('#item-shelf-select').select_option('shelf-1')
    expect(page.locator('#editor-message')).to_contain_text('пересекается')
    assert current()['children'][-1]['shelfId']=='shelf-2'
    # Move the upper block to a free place on the lower shelf.
    page.locator('#item-move').click();page.locator('#shelf-select').select_option('shelf-1');click_shelf(page,current(),1.2,3.2)
    assert current()['children'][-1]['z']==0 and current()['children'][-1]['y']==2
    page.locator('#close-shelf-inspector').click()
    # Horizontal brush, one-click riser, then continue on the destination shelf.
    page.keyboard.press('Tab');page.locator('#editor-pipe-palette [data-pipe-choose]').click()
    a=shelf_point(page,current(),3.5,3.5);b=shelf_point(page,current(),5.5,3.5)
    page.mouse.move(*a);page.mouse.down();page.mouse.move(*b,steps=8);page.mouse.up()
    assert len(current()['pipes'])==3
    page.locator('#shelf-riser-up').click();click_shelf(page,current(),5.5,3.5)
    expect(page.locator('#shelf-select')).to_have_value('shelf-2')
    assert len([p for p in current()['pipes']if p['x']==5 and p['y']==3])==5
    click_shelf(page,current(),3.5,3.5)
    assert any(p['x']==3 and p['z']==4 for p in current()['pipes'])
    page.keyboard.press('Escape');page.keyboard.press('Backspace');click_shelf(page,current(),5.5,3.5)
    assert not any(p['x']==5 and p['y']==3 for p in current()['pipes'])
    page.keyboard.press('Escape')
    # Edit partition heights, reject a shelf too low for its blocks, split/merge an empty top shelf.
    page.locator('#shelf-settings-button').click();page.locator('#shelf-height-1').fill('.75');page.locator('#shelf-height-2').fill('1.25');page.locator('#frame-form button[type=submit]').click()
    assert [s['height']for s in current()['shelves']]==[3,5]
    page.locator('#shelf-settings-button').click();page.locator('#shelf-height-1').fill('.25');page.locator('#shelf-height-2').fill('1.75');page.locator('#frame-form button[type=submit]').click()
    expect(page.locator('#editor-message')).to_contain_text('высот')
    assert [s['height']for s in current()['shelves']]==[3,5]
    page.locator('#shelf-height-1').fill('.75');page.locator('#shelf-height-2').fill('1.25');page.locator('#add-shelf').click();page.locator('#frame-form button[type=submit]').click()
    assert len(current()['shelves'])==3
    page.locator('#shelf-settings-button').click();page.locator('#remove-shelf').click();page.locator('#frame-form button[type=submit]').click()
    assert len(current()['shelves'])==2
    page.locator('#shelf-zoom-in').click();page.locator('#shelf-fit').click()
    # Switching with the keyboard and save/reload do not disturb the contents.
    page.locator('#shelf-canvas').focus();page.keyboard.press('PageDown');expect(page.locator('#shelf-select')).to_have_value('shelf-1')
    saved=snapshot(page);assert saved['version']==6
    page.locator('#close-frame-editor').click();page.reload();page.wait_for_selector('.catalog-card',state='attached');assert snapshot(page)==saved
    click_world(page,10,3);page.locator('#edit-frame').click()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path='/workspace/shared/trail-shelves-mobile.png'if page.viewport_size['width']<500 else '/workspace/shared/trail-shelves-editor.png')
    # Two port clicks can also connect blocks across shelves, without manual Z editing.
    page.locator('#close-frame-editor').click()
    make=lambda id,x,z,shelf:{'id':id,'type':'machine','x':x,'y':1,'z':z,'rotation':0,'width':2,'depth':2,'height':2,'shelfId':shelf}
    fixture={'version':2,'wagon':saved['wagon'],'nextId':2,'player':{'x':3,'y':6,'angle':0},'objects':[{'id':'object-1','type':'frame','x':10,'y':1,'z':0,'rotation':0,'width':10,'depth':6,'height':8,'mount':'floor','shelves':[{'id':'shelf-1','z':0,'height':4},{'id':'shelf-2','z':4,'height':4}],'nextItemId':3,'children':[make('item-1',0,0,'shelf-1'),make('item-2',6,4,'shelf-2')]}]}
    page.keyboard.press('Tab');page.locator('#import-file').set_input_files({'name':'two-shelves.json','mimeType':'application/json','buffer':json.dumps(fixture).encode()});expect(page.locator('#toast')).to_contain_text('импортирована');page.keyboard.press('Escape');click_world(page,14,4);page.locator('#edit-frame').click()
    page.keyboard.press('Tab');page.locator('#connect-ports-tool').click();click_shelf(page,current(),2,2.5);page.locator('#shelf-select').select_option('shelf-2');click_shelf(page,current(),6,2.5)
    expect(page.locator('#editor-message')).to_contain_text('соединены')
    expect(page.locator('#editor-network summary')).to_contain_text('Связи: 1')
    assert not errors,errors

with sync_playwright()as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    run(browser.new_page(viewport={'width':1440,'height':1000}))
    run(browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True))
    browser.close();print('PASS: desktop/mobile shelf painting, occupancy, collision-safe move between shelves, riser/continuation/removal, editable heights, split/merge, zoom, keyboard navigation and v6 reload')
