"""Production through native controls, v4 persistence and reversible demo."""
import json
from playwright.sync_api import sync_playwright, expect
from browser_helpers import snapshot, click_shelf

def run(page,phone=False):
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto('http://127.0.0.1:4173');page.wait_for_selector('.catalog-card',state='attached')
    original=snapshot(page)
    page.locator('#world-simulation [data-production-demo]').click()
    expect(page.locator('#frame-editor')).to_be_visible()
    expect(page.locator('#editor-network summary')).to_contain_text('Связи: 5')
    state=lambda:snapshot(page)
    frame=lambda:state()['objects'][0]
    sim=lambda:state()['simulation']
    owner=lambda i:f"{frame()['id']}/{frame()['children'][i]['id']}"
    step=page.locator('#editor-simulation [data-sim-step]')
    step.click();assert sim()['tick']==1
    assert sum(len(tokens)for tokens in sim()['pipes'].values())==1
    page.locator('#editor-simulation [data-sim-toggle]').click()
    expect(step).to_be_disabled()
    page.wait_for_timeout(650)
    page.locator('#editor-simulation [data-sim-toggle]').click()
    frozen=sim()['tick'];page.wait_for_timeout(300);assert sim()['tick']==frozen
    # Advance with the same native single-step button used to inspect a line.
    for _ in range(75):step.click()
    assert sim()['containers'][owner(3)]['stored'].get('clean',0)>0
    click_shelf(page,frame(),25.7,2)
    inspector=page.locator('#item-production')
    expect(inspector.locator('.production-inspector')).to_be_visible()
    expect(inspector.locator('h3')).to_contain_text('Бак')
    expect(inspector.locator('.resource-stock')).to_contain_text('Чистая нефть')
    # Stock in a full pipe is protected from the eraser and can be explicitly recovered.
    filled_id=next(id for id,tokens in sim()['pipes'].items()if tokens and next(p for p in frame()['pipes']if p['id']==id)['z']<4)
    pipe=next(p for p in frame()['pipes']if p['id']==filled_id)
    local={'x':pipe['x']+.5,'y':pipe['y']+.5,'z':pipe['z']+.5}
    if not phone:
        page.keyboard.press('Backspace');click_shelf(page,frame(),local['x'],local['y'])
        expect(page.locator('#editor-message')).to_contain_text('забери')
        assert any(p['id']==filled_id for p in frame()['pipes'])
        page.keyboard.press('Escape');click_shelf(page,frame(),local['x'],local['y'])
        inspector.locator('[data-resource-collect]').click()
        assert not sim()['pipes'].get(filled_id)
    # Collect output into inventory, leaving capacity for the line to resume.
    if not phone:
        page.locator('#close-shelf-inspector').click();click_shelf(page,frame(),25.7,2)
    amount=sim()['containers'][owner(3)]['stored']['clean']
    inspector.locator('[data-resource-collect]').click()
    assert sim()['inventory']['clean']>=amount
    inspector.get_by_label('Ресурс для загрузки').select_option('clean')
    inspector.locator('[data-resource-load]').click()
    assert sim()['containers'][owner(3)]['stored']['clean']==min(4,amount)
    inspector.get_by_label('Вместимость бака').fill('1')
    inspector.locator('.capacity-field button').click()
    expect(page.locator('#editor-message')).to_contain_text('меньше')
    assert sim()['containers'][owner(3)]['capacity']==8
    inspector.locator('[data-apparatus-toggle]').click()
    assert not sim()['containers'][owner(3)]['enabled']
    inspector.locator('[data-apparatus-toggle]').click()
    for _ in range(8):step.click()
    assert sim()['containers'][owner(3)]['stored'].get('clean',0)>0
    saved=state();assert saved['version']==6
    page.reload();page.wait_for_selector('.catalog-card',state='attached');assert state()==saved
    if not phone:page.screenshot(path='/workspace/shared/trail-stage4-wagon.png')
    page.locator('#world-simulation [data-production-demo]').click()
    restored=state();assert restored['objects']==original['objects'];assert restored['simulation']==original['simulation']
    # Re-enter demo for a useful final image without touching the restored save.
    page.locator('#world-simulation [data-production-demo]').click()
    for _ in range(45):page.locator('#editor-simulation [data-sim-step]').click()
    click_shelf(page,frame(),9.7,1.7)
    if not phone:page.screenshot(path='/workspace/shared/trail-stage4-editor.png')
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors,errors

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    run(browser.new_page(viewport={'width':1600,'height':1000}))
    run(browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True),True)
    browser.close()
    print('PASS: native demo/start/pause/step; production/colored contents; filled pipe protection and recovery; output collection/resume; v6 reload; original layout restored; desktop/mobile without JS errors')
