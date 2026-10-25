"""Browser acceptance check. Run against npm run dev; uses installed Playwright."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

OUTPUT = Path('/workspace/shared')

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1000}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    assert page.goto('http://127.0.0.1:4173').status == 200
    page.wait_for_selector('.catalog-card')

    def click_world(x, y):
        box = page.locator('#game').bounding_box()
        vertical = box['width'] < 570
        scale = min((box['height'] - 100) / 48, (box['width'] - 80) / 12) if vertical else min((box['width'] - 110) / 48, (box['height'] - 120) / 12)
        dx, dy = ((6 - y) * scale, (x - 24) * scale) if vertical else ((x - 24) * scale, (y - 6) * scale)
        page.mouse.click(box['x'] + box['width'] / 2 + dx, box['y'] + box['height'] / 2 + dy)

    def snapshot():
        page.locator('#save').click()
        return json.loads(page.evaluate("localStorage.getItem('trail.stage1.layout.v1')"))

    assert len(snapshot()['objects']) == 4
    # Real keyboard movement and collision against a frame at x=7, y=1.
    page.keyboard.down('ArrowUp'); page.wait_for_timeout(350); page.keyboard.up('ArrowUp')
    page.keyboard.down('ArrowRight'); page.wait_for_timeout(1600); page.keyboard.up('ArrowRight')
    player = snapshot()['player']
    assert 5.8 < player['x'] <= 6.001, player
    assert player['y'] < 4, player
    # Invalid positions preserve the layout and show the specific reason.
    page.locator('[data-type="frame"]').click()
    click_world(10, 3)
    assert 'занято' in page.locator('#placement').inner_text()
    assert len(snapshot()['objects']) == 4
    click_world(-1, 6)
    assert 'границами' in page.locator('#placement').inner_text()
    assert len(snapshot()['objects']) == 4
    # Install a frame at x=25,y=6, select it, rotate, move and cancel.
    click_world(28.25, 8.25)
    assert len(snapshot()['objects']) == 5
    page.keyboard.press('Escape')
    click_world(28, 8)
    page.locator('#rotate-object').click()
    placed = snapshot()['objects'][-1]
    assert placed['rotation'] == 1 and placed['x'] == 25, placed
    page.locator('#move-object').click()
    click_world(38.25, 8.25)
    moved = snapshot()['objects'][-1]
    assert moved['id'] == placed['id'] and moved['x'] == 36 and moved['y'] == 5, moved
    page.locator('#move-object').click()
    page.mouse.move(400, 200)
    page.keyboard.press('Escape')
    assert snapshot()['objects'][-1] == moved
    # Delete then reload the saved layout without replacing the save.
    page.locator('#delete-object').click()
    assert page.locator('#object-count').inner_text() == '04'
    page.locator('#load').click()
    assert page.locator('#object-count').inner_text() == '05'
    # A page reload automatically restores the same layout and player.
    saved = snapshot()
    page.reload(); page.wait_for_selector('.catalog-card')
    assert snapshot() == saved
    # Player itself also blocks placement.
    page.locator('[data-type="storage"]').click()
    player = saved['player']
    click_world(player['x'], player['y'])
    assert 'персонаж' in page.locator('#placement').inner_text()
    page.keyboard.press('Escape')
    # Import rejects corrupt geometry atomically.
    bad = json.loads(json.dumps(saved)); bad['objects'][0]['x'] = -5
    page.locator('#import-file').set_input_files({'name': 'broken.json', 'mimeType': 'application/json', 'buffer': json.dumps(bad).encode()})
    expect(page.locator('#toast')).to_contain_text('отклонён')
    assert snapshot() == saved
    # Exported JSON can be imported back.
    with page.expect_download() as download_info:
        page.locator('#export').click()
    exported = Path(download_info.value.path()).read_text()
    assert json.loads(exported) == saved
    page.locator('#import-file').set_input_files({'name': 'layout.json', 'mimeType': 'application/json', 'buffer': exported.encode()})
    expect(page.locator('#toast')).to_contain_text('импортирована')
    assert snapshot() == saved
    page.locator('#walk-mode').click()
    page.screenshot(path=str(OUTPUT / 'trail-desktop.png'), full_page=True)
    # Narrow layout must fit the screen, with working portrait coordinate mapping.
    page.set_viewport_size({'width': 390, 'height': 844})
    page.wait_for_timeout(100)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.locator('[data-type="storage"]').click()
    click_world(44.75, 9.75)
    assert page.locator('#object-count').inner_text() == '06'
    page.keyboard.press('Escape')
    page.screenshot(path=str(OUTPUT / 'trail-mobile.png'), full_page=True)
    assert not errors, errors
    browser.close()
    print('PASS: movement, collision, boundary/overlap/player errors, placement, rotation, move/cancel, delete, save/load/reload, JSON import/export, mobile, no JS errors')
