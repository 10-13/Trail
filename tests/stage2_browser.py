"""Stage 2 acceptance: real UI, all three drag planes, volume checks and persistence."""
import json
from io import BytesIO
from PIL import Image
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    assert page.goto('http://127.0.0.1:4173').status == 200
    page.wait_for_selector('.catalog-card', state='attached')

    def snapshot():
        page.keyboard.press('Control+s')
        return json.loads(page.evaluate("localStorage.getItem('trail.stage1.layout.v1')"))

    def click_world(x, y, target=page):
        box = target.locator('#game').bounding_box()
        vertical = box['width'] < 570
        scale = max(1, min((box['height'] - 400) / 48, (box['width'] - 80) / 12)) if vertical else min((box['width'] - 110) / 48, (box['height'] - 120) / 12)
        dx, dy = ((6 - y) * scale, (x - 24) * scale) if vertical else ((x - 24) * scale, (y - 6) * scale)
        target.mouse.click(box['x'] + box['width'] / 2 + dx, box['y'] + box['height'] / 2 + dy)

    def apply_item(**values):
        for key, value in values.items(): page.locator(f'#item-{key}').fill(str(value))
        page.locator('#item-form button[type=submit]').click()

    def current_frame(): return snapshot()['objects'][-1]
    def current_item(): return current_frame()['children'][0]

    def check_editor_layout(target):
        expect(target.locator('#viewport')).to_be_hidden()
        expect(target.locator('.hud')).to_be_hidden()
        assert target.locator('#frame-editor').bounding_box() == {'x': 0, 'y': 0, 'width': target.viewport_size['width'], 'height': target.viewport_size['height']}
        xy = target.locator('[data-plane="xy"]').bounding_box()
        xz = target.locator('[data-plane="xz"]').bounding_box()
        yz = target.locator('[data-plane="yz"]').bounding_box()
        assert abs(xy['x'] - xz['x']) < 1 and xy['y'] + xy['height'] <= xz['y']
        assert abs(xz['y'] - yz['y']) < 1 and xz['x'] + xz['width'] <= yz['x']
        # Inspect the actual gold frame outlines to verify shared scale and alignment.
        outlines = {}
        for plane in ['xy', 'xz', 'yz']:
            canvas = target.locator(f'#view-{plane}')
            image = Image.open(BytesIO(canvas.screenshot())).convert('RGB')
            points = [(x, y) for y in range(image.height) for x in range(image.width)
                      if (lambda r, g, b: r > 85 and g > 65 and r > g > b)(*image.getpixel((x, y)))]
            assert points, f'No frame outline in {plane}'
            box = canvas.bounding_box()
            outlines[plane] = [min(x for x, y in points) + box['x'], max(x for x, y in points) + box['x'], min(y for x, y in points) + box['y'], max(y for x, y in points) + box['y']]
        assert abs(outlines['xy'][0] - outlines['xz'][0]) <= 1 and abs(outlines['xy'][1] - outlines['xz'][1]) <= 1, outlines
        assert abs(outlines['xz'][2] - outlines['yz'][2]) <= 1 and abs(outlines['xz'][3] - outlines['yz'][3]) <= 1, outlines

    def drag(plane, delta0, delta1):
        current = current_frame(); item = current['children'][0]
        definition = {'xy': (['x', 'y'], ['width', 'depth'], False), 'xz': (['x', 'z'], ['width', 'height'], True), 'yz': (['y', 'z'], ['depth', 'height'], True)}
        axes, sizes, flip = definition[plane]
        box = page.locator(f'#view-{plane}').bounding_box()
        width, height = current[sizes[0]], current[sizes[1]]
        all_sizes = {'xy': ['width', 'depth'], 'xz': ['width', 'height'], 'yz': ['depth', 'height']}
        scale = min(limit for key, size_keys in all_sizes.items()
                    for bounds in [page.locator(f'#view-{key}').bounding_box()]
                    for limit in [(bounds['width'] - 44) / current[size_keys[0]], (bounds['height'] - 44) / current[size_keys[1]]])
        ox, oy = (box['width'] - width * scale) / 2, (box['height'] - height * scale) / 2
        item_size = {'width': item['depth'] if item['rotation'] % 2 else item['width'], 'depth': item['width'] if item['rotation'] % 2 else item['depth'], 'height': item['height']}
        x = item[axes[0]] + item_size[sizes[0]] / 2
        y = item[axes[1]] + item_size[sizes[1]] / 2
        sx = box['x'] + ox + x * scale
        sy = box['y'] + oy + (height - y if flip else y) * scale
        page.mouse.move(sx, sy); page.mouse.down()
        page.mouse.move(sx + delta0 * scale, sy + delta1 * scale * (-1 if flip else 1), steps=5)
        page.mouse.up()

    # A configurable frame is created from the construction menu.
    page.locator('#build-mode').click()
    for key, value in [('width', 2), ('depth', 1.5), ('height', 2)]: page.locator(f'#new-frame-{key}').fill(str(value))
    page.locator('[data-type="frame"]').click()
    click_world(12.25, 9.25)
    assert len(snapshot()['objects']) == 5
    frame_id = current_frame()['id']
    assert [current_frame()[k] for k in ['width', 'depth', 'height', 'x', 'y']] == [8, 6, 8, 8, 6]
    page.keyboard.press('Escape'); page.locator('#edit-frame').click()
    expect(page.locator('#frame-editor')).to_be_visible()
    for plane in ['xy', 'xz', 'yz']: expect(page.locator(f'#view-{plane}')).to_be_visible()
    check_editor_layout(page)
    page.locator('#save-editor').click()
    before_return = snapshot()
    page.keyboard.press('Escape')
    expect(page.locator('#frame-editor')).to_be_hidden()
    expect(page.locator('#viewport')).to_be_visible()
    expect(page.locator('.hud')).to_be_visible()
    assert snapshot() == before_return
    page.keyboard.press('e')
    expect(page.locator('#frame-editor')).to_be_visible()
    assert page.evaluate('''() => {
      const group = document.querySelector('#editor-views').getBoundingClientRect();
      return [...document.querySelectorAll('.ortho-view')].every(node => node.getBoundingClientRect().bottom <= group.bottom + 1);
    }'''), 'Projection controls must fit in the editor workspace'
    before_player = snapshot()['player']
    page.keyboard.down('w'); page.wait_for_timeout(150); page.keyboard.up('w')
    assert snapshot()['player'] == before_player
    page.locator('#add-machine').click()
    apply_item(width=.75, depth=.5, height=.5, x=.25, y=.25, z=.25)
    assert [current_item()[k] for k in ['width', 'depth', 'height', 'x', 'y', 'z']] == [3, 2, 2, 1, 1, 1]
    # Each projection changes exactly its own two coordinates.
    drag('xy', 2, 1)
    assert [current_item()[k] for k in ['x', 'y', 'z']] == [3, 2, 1], current_item()
    drag('xz', 1, 2)
    assert [current_item()[k] for k in ['x', 'y', 'z']] == [4, 2, 3], current_item()
    drag('yz', 1, 1)
    assert [current_item()[k] for k in ['x', 'y', 'z']] == [4, 3, 4], current_item()
    before = current_item()
    drag('xy', 8, 0)
    expect(page.locator('#editor-message')).to_contain_text('границы')
    assert current_item() == before
    page.locator('#item-rotate').click()
    assert current_item()['rotation'] == 1
    # Distinct depth layers can occupy the same projected XY footprint.
    page.locator('#add-tank').click()
    apply_item(x=1, y=.75, z=0, width=.5, depth=.5, height=1)
    assert len(current_frame()['children']) == 2
    assert current_frame()['children'][1]['x'] == 4
    before = current_frame()
    apply_item(z=.75)
    expect(page.locator('#editor-message')).to_contain_text('пересекается')
    assert current_frame() == before
    apply_item(x=2, z=0)
    expect(page.locator('#editor-message')).to_contain_text('границы')
    assert current_frame() == before
    # Resizing a frame must never eject its contents.
    page.locator('#edit-frame-height').fill('1')
    page.locator('#frame-form button[type=submit]').click()
    expect(page.locator('#editor-message')).to_contain_text('границы')
    assert current_frame() == before
    page.locator('#edit-frame-height').fill('2.25')
    page.locator('#frame-form button[type=submit]').click()
    assert current_frame()['height'] == 9
    check_editor_layout(page)
    # Selecting from the list moves all slices to the chosen depth.
    page.locator('[data-item-id="item-1"]').click()
    assert page.locator('#slice-xy').input_value() == '4'
    page.locator('#slice-xy').fill('0')
    assert page.locator('#slice-xy').input_value() == '0'
    page.locator('[data-item-id="item-1"]').click()
    page.screenshot(path='/workspace/shared/trail-stage2-editor.png')
    # Delete both children; convert to a ceiling frame and add a shallow module.
    page.locator('#item-delete').click()
    page.locator('[data-item-id="item-2"]').click(); page.locator('#item-delete').click()
    assert current_frame()['children'] == []
    page.locator('#edit-frame-height').fill('0.5')
    page.locator('#edit-frame-mount').select_option('ceiling')
    page.locator('#frame-form button[type=submit]').click()
    assert current_frame()['mount'] == 'ceiling' and current_frame()['z'] == 8
    expect(page.locator('#frame-clearance')).to_contain_text('проход свободен')
    page.locator('#add-machine').click()
    assert current_item()['height'] == 2
    page.locator('#close-frame-editor').click()
    # Walk under the frame, then reject lowering it onto the character.
    page.keyboard.down('s'); page.wait_for_timeout(350); page.keyboard.up('s')
    page.keyboard.down('d'); page.wait_for_timeout(1450); page.keyboard.up('d')
    player = snapshot()['player']; assert 8 < player['x'] < 16 and player['y'] > 6, player
    click_world(12, 9); page.locator('#edit-frame').click()
    page.locator('#edit-frame-height').fill('0.75'); page.locator('#frame-form button[type=submit]').click()
    expect(page.locator('#editor-message')).to_contain_text('персонаж')
    assert current_frame()['z'] == 8
    page.locator('#close-frame-editor').click()
    page.keyboard.down('a'); page.wait_for_timeout(1800); page.keyboard.up('a')
    click_world(12, 9); page.locator('#edit-frame').click()
    page.locator('#edit-frame-height').fill('0.75'); page.locator('#frame-form button[type=submit]').click()
    assert current_frame()['z'] == 7
    expect(page.locator('#frame-clearance')).to_contain_text('проход перекрыт')
    page.locator('#close-frame-editor').click()
    page.keyboard.down('d'); page.wait_for_timeout(1800); page.keyboard.up('d')
    player = snapshot()['player']; assert player['x'] <= 7.001, player
    # Save/reload preserves the actual ceiling geometry and nested module.
    saved = snapshot(); page.reload(); page.wait_for_selector('.catalog-card', state='attached')
    assert snapshot() == saved
    page.screenshot(path='/workspace/shared/trail-stage2-wagon.png')
    # Legacy stage 1 JSON imports into v2 without silently losing the layout.
    legacy = {'version': 1, 'wagon': saved['wagon'], 'nextId': 2, 'player': {'x': 3, 'y': 6, 'angle': 0}, 'objects': [{'id': 'object-1', 'type': 'frame', 'x': 10, 'y': 1, 'z': 0, 'rotation': 0}]}
    page.locator('#import-file').set_input_files({'name': 'old.json', 'mimeType': 'application/json', 'buffer': json.dumps(legacy).encode()})
    expect(page.locator('#toast')).to_contain_text('импортирована')
    migrated = snapshot(); assert migrated['version'] == 2 and len(migrated['objects']) == 1
    assert migrated['objects'][0]['width'] == 6 and migrated['objects'][0]['children'] == []
    # All three views remain available in the compact mobile editor.
    mobile = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    phone = mobile.new_page(); phone.on('pageerror', lambda error: errors.append(str(error)))
    phone.goto('http://127.0.0.1:4173'); phone.wait_for_selector('.catalog-card', state='attached')
    click_world(10, 3, phone); phone.locator('#edit-frame').tap()
    for plane in ['xy', 'xz', 'yz']: expect(phone.locator(f'#view-{plane}')).to_be_visible()
    check_editor_layout(phone)
    assert phone.evaluate('''() => {
      const group = document.querySelector('#editor-views').getBoundingClientRect();
      return [...document.querySelectorAll('.ortho-view')].every(node => node.getBoundingClientRect().bottom <= group.bottom + 1);
    }''')
    phone.locator('#add-machine').tap(); expect(phone.locator('[data-item-id="item-1"]')).to_be_visible()
    assert phone.evaluate('document.documentElement.scrollWidth <= innerWidth')
    phone.screenshot(path='/workspace/shared/trail-stage2-mobile.png')
    phone.locator('#close-frame-editor').tap(); expect(phone.locator('#frame-editor')).to_be_hidden()
    assert not errors, errors
    browser.close()
    print('PASS: configurable frame, 3 synchronized drag views, slices, item dimensions/rotation/deletion, 3D overlap/bounds, resize safety, ceiling clearance, save/reload/migration, mobile editor, no JS errors')
