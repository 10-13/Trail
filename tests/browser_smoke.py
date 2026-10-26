"""Wagon acceptance: Tab palette, repeatable paint/erase tools and free walking."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from browser_helpers import snapshot, click_world, choose_world, world_point

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
    assert page.goto('http://127.0.0.1:4173').status == 200
    page.wait_for_selector('.catalog-card', state='attached')
    assert page.locator('#walk-mode, #build-mode, .mode-switch').count() == 0
    expect(page.locator('#build-menu')).to_be_hidden()
    assert page.locator('#game').bounding_box() == {'x': 0, 'y': 0, 'width': 1440, 'height': 1000}
    page.keyboard.press('Tab'); expect(page.locator('#build-menu')).to_be_visible()
    page.keyboard.press('Tab'); expect(page.locator('#build-menu')).to_be_hidden()
    assert len(snapshot(page)['objects']) == 4
    assert page.locator('[data-type=storage], [data-type=workbench], #pipe-height, #world-pipe-palette').count()==0
    # The same brush remains selected after every placement.
    page.keyboard.press('Tab');page.locator('#new-frame-width').fill('.75');page.locator('#new-frame-depth').fill('.75');page.locator('#new-frame-height').fill('.75');page.locator('[data-type=frame]').click()
    click_world(page, 28.75, 2.75); click_world(page, 34.75, 2.75)
    assert len(snapshot(page)['objects']) == 6
    # Painting can also be performed while holding the pointer down.
    page.mouse.move(*world_point(page, 28.75, 7.75)); page.mouse.down()
    page.mouse.move(*world_point(page, 28.75, 10.75), steps=10); page.mouse.up()
    assert len(snapshot(page)['objects']) == 8
    before = snapshot(page)['player']
    page.keyboard.down('d'); page.wait_for_timeout(250); page.keyboard.up('d')
    assert snapshot(page)['player']['x'] > before['x'], 'Walking must work with a paint brush active'
    # Overlap, walls and the player are still rejected.
    click_world(page, 28.75, 2.75); assert len(snapshot(page)['objects']) == 8
    expect(page.locator('#placement')).to_contain_text('занято')
    click_world(page, -1, 6); expect(page.locator('#placement')).to_contain_text('границами')
    player = snapshot(page)['player']; click_world(page, player['x'], player['y'])
    expect(page.locator('#placement')).to_contain_text('персонаж')
    # Backspace only arms the eraser; clicking removes one object, and it stays active.
    page.keyboard.press('Backspace'); assert len(snapshot(page)['objects']) == 8
    click_world(page, 28.75, 2.75); assert len(snapshot(page)['objects']) == 7
    click_world(page, 34.75, 2.75); assert len(snapshot(page)['objects']) == 6
    before = snapshot(page)['player']
    page.keyboard.down('s'); page.wait_for_timeout(200); page.keyboard.up('s')
    assert snapshot(page)['player']['y'] > before['y'], 'Walking must work with the eraser active'
    page.keyboard.press('Escape')
    # Move and rotate an existing object without creating a walking/build mode.
    click_world(page, 28.75, 7.75); page.keyboard.press('m')
    click_world(page, 38.75, 8.75)
    assert snapshot(page)['objects'][-2]['x'] == 37
    page.keyboard.press('r'); assert snapshot(page)['objects'][-2]['rotation'] == 1
    saved = snapshot(page)
    page.keyboard.press('Backspace'); click_world(page, 38.75, 8.75)
    assert len(json.loads(page.evaluate("localStorage.getItem('trail.stage1.layout.v1')"))['objects']) == 6
    page.locator('#load').click(); assert snapshot(page) == saved
    page.reload(); page.wait_for_selector('.catalog-card', state='attached'); assert snapshot(page) == saved
    bad = json.loads(json.dumps(saved)); bad['objects'][0]['x'] = -5
    page.locator('#import-file').set_input_files({'name':'bad.json','mimeType':'application/json','buffer':json.dumps(bad).encode()})
    expect(page.locator('#toast')).to_contain_text('отклонён'); assert snapshot(page) == saved
    page.keyboard.press('Tab')
    with page.expect_download() as download_info: page.locator('#export').click()
    exported = Path(download_info.value.path()).read_text(); assert json.loads(exported) == saved
    page.locator('#import-file').set_input_files({'name':'layout.json','mimeType':'application/json','buffer':exported.encode()})
    expect(page.locator('#toast')).to_contain_text('импортирована'); assert snapshot(page) == saved
    page.keyboard.press('Escape')
    page.screenshot(path='/workspace/shared/trail-wagon-brush.png')
    phone = browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True).new_page()
    phone.on('pageerror',lambda e:errors.append(str(e)))
    phone.goto('http://127.0.0.1:4173'); phone.wait_for_selector('.catalog-card',state='attached')
    phone.locator('#build-menu-button').tap(); phone.locator('#new-frame-width').fill('.75');phone.locator('#new-frame-depth').fill('.75');phone.locator('#new-frame-height').fill('.75');phone.locator('[data-type="frame"]').tap()
    click_world(phone, 44.75, 9.75); assert len(snapshot(phone)['objects']) == 5
    phone.locator('#erase-tool').tap(); click_world(phone, 44.75, 9.75)
    assert len(snapshot(phone)['objects']) == 4
    expect(phone.locator('#touch-pad')).to_be_visible()
    assert phone.evaluate('document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight')
    assert not errors, errors
    browser.close()
    print('PASS: no walking/build modes; Tab palette; repeated clicks and drag painting; Backspace click eraser; free movement with both tools; collision/move/rotation/save/load/import/export; touch controls; no JS errors')
