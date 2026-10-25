"""Native UI acceptance for neighbor bridges, three-axis rotation and no tees."""
import json
from playwright.sync_api import sync_playwright, expect
from browser_helpers import snapshot, click_world, click_projection

def run(page):
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto('http://127.0.0.1:4173');page.wait_for_selector('.catalog-card',state='attached')
    initial=snapshot(page)
    item={'id':'item-1','type':'machine','x':1,'y':1,'z':1,'rotation':0,'width':2,'depth':3,'height':4}
    frames=[{'id':f'object-{i+1}','type':'frame','x':x,'y':1,'z':0,'rotation':0,'width':6,'depth':6,'height':8,'mount':'floor','nextItemId':2,'children':[item.copy()]}for i,x in enumerate([10,22])]
    fixture={'version':2,'wagon':initial['wagon'],'nextId':3,'player':{'x':3,'y':6,'angle':0},'objects':frames}
    page.keyboard.press('Tab');page.locator('#import-file').set_input_files({'name':'neighbors.json','mimeType':'application/json','buffer':json.dumps(fixture).encode()})
    page.keyboard.press('Escape');click_world(page,12,4);page.locator('#edit-frame').click()
    frame=lambda:snapshot(page)['objects'][0]
    nearby=page.locator('#neighbor-connections');nearby.locator('summary').click()
    expect(nearby.locator('summary')).to_contain_text('2 подключений')
    nearby.get_by_label('Подключение этого каркаса').select_option('object-1/item-1/port-2')
    nearby.get_by_label('Соседнее подключение').select_option('object-2/item-1/port-1')
    # Equipment can turn around X and Y; restoring the orientation restores the graph.
    click_projection(page,'xy',frame(),{'x':1.4,'y':1.4,'z':1})
    expect(page.locator('#item-form')).to_be_visible()
    axis=page.locator('#editor-rotation [data-rotation-axis]');turn=page.locator('#editor-rotation [data-rotate-active]')
    axis.select_option('x');turn.click();assert 'orientation' in frame()['children'][0]
    axis.select_option('y');turn.click();assert frame()['children'][0]['orientation']!=[1,3,-2]
    for _ in range(3):turn.click()
    axis.select_option('x')
    for _ in range(3):turn.click()
    assert frame()['children'][0].get('orientation') is None
    expect(page.locator('#editor-network summary')).to_contain_text('Связи: 0')
    nearby.locator('[data-connect-frames]').click()
    expect(page.locator('#editor-network summary')).to_contain_text('Связи: 1')
    state=snapshot(page);assert any(16<=pipe['x']<22 for pipe in state['pipes']);assert all(len(pipe['faces'])==2 for pipe in state['pipes'])
    page.screenshot(path='/workspace/shared/trail-neighbor-connections.png')
    # A pipe from the inter-frame bridge rotates in local X/Y/Z axes too.
    click_projection(page,'xy',frame(),{'x':4.5,'y':2.5,'z':1})
    expect(page.locator('#editor-pipe-inspector')).to_be_visible()
    axis.select_option('y');turn.click()
    pipe=next(p for p in snapshot(page)['pipes'] if p['x']==14)
    assert set(pipe['faces'])=={'nz','pz'},pipe
    expect(page.locator('#editor-network summary')).to_contain_text('Связи: 0')
    for _ in range(3):turn.click()
    expect(page.locator('#editor-network summary')).to_contain_text('Связи: 1')
    page.locator('#close-frame-editor').click()
    click_world(page,12,4)
    page.locator('#world-rotation [data-rotation-axis]').select_option('x')
    page.locator('#world-rotation [data-rotate-active]').click()
    assert snapshot(page)['objects'][0]['orientation']==[1,3,-2]
    saved=snapshot(page);page.reload();page.wait_for_selector('.catalog-card',state='attached');assert snapshot(page)==saved
    # The tee is absent from both palettes.
    page.keyboard.press('Tab');assert page.locator('#world-pipe-palette option[value="tee"]').count()==0
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors,errors

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    run(browser.new_page(viewport={'width':1440,'height':1000}))
    run(browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True))
    browser.close()
    print('PASS: desktop and mobile neighbor ports/bridge across gap; X/Y equipment and pipe turns; frame X turn; native save/reload; no tee; no overflow or JS errors')
