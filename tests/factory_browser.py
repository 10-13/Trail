"""Open, inspect, run and restore the larger example using the game controls."""
import json
from playwright.sync_api import sync_playwright,expect
from browser_helpers import snapshot,click_world

def stock(saved,resource):
    return sum(c['stored'].get(resource,0)for c in saved['simulation']['containers'].values())

def run(page,phone=False):
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://127.0.0.1:4173');page.wait_for_selector('.catalog-card',state='attached');original=snapshot(page)
    if not phone:
        page.locator('#world-simulation [data-production-demo]').click()
        page.locator('#editor-simulation [data-factory-demo]').click()
    else:page.locator('#world-simulation [data-factory-demo]').click()
    expect(page.locator('#rack-overview')).to_be_visible()
    assert json.loads(page.evaluate("localStorage.getItem('trail.stage1.layout.v1')"))==original,'Opening a demo must preserve the saved layout'
    expect(page.locator('#editor-network summary')).to_contain_text('Связи: 10')
    expect(page.locator('#editor-simulation [data-factory-demo]')).to_be_visible()
    loaded=snapshot(page);assert len(loaded['objects'])==3;assert sum(len(f['children'])for f in loaded['objects'])==12
    if not phone:
        for _ in range(100):page.locator('#editor-simulation [data-sim-step]').click()
        working=snapshot(page);assert stock(working,'clean')>0;assert stock(working,'crude')>0
        assert sum(len(t)for t in working['simulation']['pipes'].values())>0
        page.mouse.move(5,5);page.screenshot(path='/workspace/shared/trail-factory-overview.png')
        page.locator('[data-rack-shelf=shelf-1]').click();page.mouse.move(5,5);page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');page.screenshot(path='/workspace/shared/trail-factory-lower.png')
        page.locator('#shelf-select').select_option('shelf-2');page.mouse.move(5,5);page.screenshot(path='/workspace/shared/trail-factory-upper.png')
        page.locator('#close-frame-editor').click();page.wait_for_function("()=>{const c=document.getElementById('game');return c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data[1]>30}");page.screenshot(path='/workspace/shared/trail-factory-wagon.png')
        click_world(page,24,6);page.locator('#edit-frame').click()
    else:
        page.locator('[data-rack-shelf=shelf-2]').tap();expect(page.locator('#shelf-canvas')).to_be_visible();expect(page.locator('#shelf-select')).to_have_value('shelf-2')
        page.screenshot(path='/workspace/shared/trail-factory-phone.png')
    page.locator('#editor-simulation [data-sim-fast]').click()
    for _ in range(50):
        page.wait_for_timeout(100)
        if stock(snapshot(page),'clean')==128:break
    page.locator('#editor-simulation [data-sim-toggle]').click();finished=snapshot(page)
    assert stock(finished,'clean')==128 and stock(finished,'sludge')==64 and stock(finished,'residue')==64
    assert all(len(t)<=4 for t in finished['simulation']['pipes'].values())
    page.reload();page.wait_for_selector('.catalog-card',state='attached');assert snapshot(page)==finished
    page.locator('#world-simulation [data-production-demo]').click();restored=snapshot(page)
    assert restored==original,'Returning from the factory must restore the complete original state'
    expect(page.locator('#world-simulation [data-factory-demo]')).to_be_visible()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors,errors

with sync_playwright()as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    run(browser.new_page(viewport={'width':1600,'height':1000}))
    run(browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True),True)
    browser.close();print('PASS: large example controls, both shelves, visible active transport, complete yields, save/reload and exact original restoration on desktop and phone')
