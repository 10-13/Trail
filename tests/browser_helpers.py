import json
from io import BytesIO
from PIL import Image
from playwright.sync_api import expect


def snapshot(page):
    page.keyboard.press('Control+s')
    return json.loads(page.evaluate("localStorage.getItem('trail.stage1.layout.v1')"))


def world_point(page, x, y):
    box = page.locator('#game').bounding_box()
    vertical = box['width'] < 570
    scale = max(1, min((box['height'] - 400) / 48, (box['width'] - 80) / 12)) if vertical else min((box['width'] - 110) / 48, (box['height'] - 120) / 12)
    dx, dy = ((6 - y) * scale, (x - 24) * scale) if vertical else ((x - 24) * scale, (y - 6) * scale)
    return box['x'] + box['width'] / 2 + dx, box['y'] + box['height'] / 2 + dy


def click_world(page, x, y):
    page.mouse.click(*world_point(page, x, y))


def choose_world(page, kind):
    page.keyboard.press('Tab')
    expect(page.locator('#build-menu')).to_be_visible()
    page.locator(f'[data-type="{kind}"]').click()
    expect(page.locator('#build-menu')).to_be_hidden()


def choose_equipment(page, kind='machine', **sizes):
    page.keyboard.press('Tab')
    expect(page.locator('#editor-menu')).to_be_visible()
    for key, value in sizes.items(): page.locator(f'#brush-{key}').fill(str(value))
    page.locator(f'[data-equipment-type="{kind}"]').click()
    expect(page.locator('#editor-menu')).to_be_hidden()


def view_geometry(page, plane, current):
    canvas = page.locator(f'#view-{plane}')
    image = Image.open(BytesIO(canvas.screenshot())).convert('RGB')
    columns = {}; points = []
    for index, (r, g, b) in enumerate(image.getdata()):
        # Gold boundary, including antialiasing against the blue canvas background.
        # Excludes red floor hatching, blue objects and the orange cut-plane handles.
        if r > 65 and g > 60 and g > b + 12 and 1.22 < (r - 17) / max(1, g - 28) < 1.29:
            x, y = index % image.width, index // image.width
            columns[x] = columns.get(x, 0) + 1; points.append((x, y))
    assert points, f'No gold frame boundary in {plane}'
    # Borders are long strokes; a port marker must not expand the measured frame.
    edges = [x for x, count in columns.items() if count >= max(columns.values()) * .45]
    left, right = min(edges), max(edges)
    edge_rows = [y for x, y in points if x <= left + 1 or x >= right - 1]
    top, bottom = min(edge_rows), max(edge_rows)
    rect = canvas.bounding_box()
    axes, sizes, flip = {'xz': (['x', 'z'], ['width', 'height'], True), 'yz': (['y', 'z'], ['depth', 'height'], True), 'xy': (['x', 'y'], ['width', 'depth'], False) if current['width'] >= current['depth'] else (['y', 'x'], ['depth', 'width'], False)}[plane]
    scale = ((right - left) / current[sizes[0]] + (bottom - top) / current[sizes[1]]) / 2
    return {'left': left + rect['x'], 'right': right + rect['x'], 'top': top + rect['y'], 'bottom': bottom + rect['y'], 'local': (left, right, top, bottom), 'scale': scale, 'axes': axes, 'sizes': sizes, 'flip': flip, 'image': image, 'rect': rect}


def projection_point(page, plane, current, coords):
    g = view_geometry(page, plane, current)
    x, y = coords[g['axes'][0]], coords[g['axes'][1]]
    return g['left'] + x * g['scale'], g['bottom'] - y * g['scale'] if g['flip'] else g['top'] + y * g['scale']


def click_projection(page, plane, current, coords):
    page.mouse.click(*projection_point(page, plane, current, coords))


def drag_slice(page, plane, current, index, destination):
    g = view_geometry(page, plane, current)
    image, (left, right, top, bottom) = g['image'], g['local']
    color = (116, 175, 202) if index == 0 else (213, 169, 109)
    points = [(i % image.width, i // image.width) for i, pixel in enumerate(image.getdata())
              if pixel == color and ((i // image.width < top - 3) if index == 0 else (i % image.width < left - 3))]
    assert points, (plane, index, 'No cut-plane handle')
    x, y = sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points)
    sx, sy = x + g['rect']['x'], y + g['rect']['y']
    ex = g['left'] + (destination + .5) * g['scale'] if index == 0 else sx
    ey = (g['bottom'] - (destination + .5) * g['scale'] if g['flip'] else g['top'] + (destination + .5) * g['scale']) if index == 1 else sy
    page.mouse.move(sx, sy); page.mouse.down(); page.mouse.move(ex, ey, steps=6); page.mouse.up()


def check_editor_layout(page, current):
    expect(page.locator('#viewport')).to_be_hidden()
    expect(page.locator('.hud')).to_be_hidden()
    assert page.locator('#frame-editor').bounding_box() == {'x': 0, 'y': 0, 'width': page.viewport_size['width'], 'height': page.viewport_size['height']}
    assert page.locator('.equipment-panel, .editor-header, input[type=range]').count() == 0
    assert not page.locator('#frame-editor').inner_text().count('XYZ')
    boxes = {key: page.locator(f'[data-plane="{key}"]').bounding_box() for key in ['xz', 'yz', 'xy']}
    major = 'xz' if current['width'] >= current['depth'] else 'yz'
    assert abs(boxes['xz']['y'] - boxes['yz']['y']) < 1
    assert boxes['xz']['x'] + boxes['xz']['width'] <= boxes['yz']['x']
    assert abs(boxes['xy']['x'] - boxes[major]['x']) < 1
    assert boxes[major]['y'] + boxes[major]['height'] <= boxes['xy']['y']
    geom = {key: view_geometry(page, key, current) for key in ['xz', 'yz', 'xy']}
    assert abs(geom['xz']['top'] - geom['yz']['top']) <= 2 and abs(geom['xz']['bottom'] - geom['yz']['bottom']) <= 2, geom
    assert abs(geom['xy']['left'] - geom[major]['left']) <= 2 and abs(geom['xy']['right'] - geom[major]['right']) <= 2, geom
    for key, g in geom.items():
        image = g['image']; left, right, top, bottom = g['local']
        if key == 'xy':
            red = sum(1 for y in range(top + 1, bottom) for x in range(left + 1, right) if (lambda r, gg, b: r > gg + 15 and r > b + 15)(*image.getpixel((x, y))))
            assert red > 10, 'Top view must show red floor hatching'
        else:
            assert any((lambda r, gg, b: r > 180 and gg < 150 and b < 150)(*image.getpixel(((left + right) // 2, y))) for y in range(max(0, bottom - 2), min(image.height, bottom + 3))), 'Side view must show the red bottom boundary'
