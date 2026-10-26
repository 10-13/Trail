import json
import base64
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


def shelf_geometry(page,current):
    if not page.locator('#shelf-canvas').is_visible():page.locator('#rack-view-plan').click()
    canvas=page.locator('#shelf-canvas')
    image=Image.open(BytesIO(base64.b64decode(canvas.evaluate("node=>node.toDataURL().split(',')[1]")))).convert('RGB')
    columns={};points=[]
    for index,(r,g,b)in enumerate(image.getdata()):
        if r>65 and g>60 and g>b+12 and 1.22<(r-17)/max(1,g-28)<1.29:
            x,y=index%image.width,index//image.width;columns[x]=columns.get(x,0)+1;points.append((x,y))
    assert points,'No shelf boundary'
    edges=[x for x,n in columns.items()if n>=max(columns.values())*.45]
    left,right=min(edges),max(edges);rows=[y for x,y in points if x<=left+1 or x>=right-1]
    top,bottom=min(rows),max(rows);rect=canvas.bounding_box();dpr=image.width/rect['width']
    scale=((right-left)/current['width']+(bottom-top)/current['depth'])/2/dpr
    return {'left':left/dpr+rect['x'],'top':top/dpr+rect['y'],'scale':scale}


def shelf_point(page,current,x,y):
    geometry=shelf_geometry(page,current)
    return geometry['left']+x*geometry['scale'],geometry['top']+y*geometry['scale']

def click_shelf(page,current,x,y):
    page.mouse.click(*shelf_point(page,current,x,y))
