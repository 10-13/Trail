"""Side view hover expansion selects the shelf used by the existing plan editor."""
from playwright.sync_api import sync_playwright,expect
from browser_helpers import snapshot,click_world,click_shelf

def open_rack(page):
 page.goto('http://127.0.0.1:4173');page.wait_for_selector('.catalog-card',state='attached');click_world(page,10,3);page.locator('#edit-frame').click();expect(page.locator('#rack-overview')).to_be_visible();expect(page.locator('#shelf-canvas')).to_be_hidden()
def add_block(page):
 page.keyboard.press('Tab');page.locator('[data-equipment-type=machine]').click();click_shelf(page,snapshot(page)['objects'][0],1.2,1.2);page.keyboard.press('Escape')
with sync_playwright()as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1440,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)));open_rack(page)
 before=snapshot(page);top=page.locator('[data-rack-shelf=shelf-2]');lower=page.locator('[data-rack-shelf=shelf-1]');expect(top).to_be_visible();base=top.bounding_box();lower_base=lower.bounding_box()
 top.hover();page.wait_for_timeout(360);grown=top.bounding_box();assert grown['height']>base['height']+30;assert abs(grown['y']+grown['height']-base['y']-base['height'])<1
 assert abs(lower.bounding_box()['height']-lower_base['height'])<1
 page.wait_for_timeout(350);assert top.bounding_box()['height']>=grown['height']-1,'Hover must stay expanded while the mouse rests inside'
 page.mouse.move(5,5);page.wait_for_timeout(400);assert abs(top.bounding_box()['height']-base['height'])<1
 assert snapshot(page)==before,'Preview must not mutate construction or resource state'
 page.mouse.click(base['x']-8,base['y']+base['height']/2-4);expect(page.locator('#shelf-canvas')).to_be_visible();expect(page.locator('#shelf-select')).to_have_value('shelf-2');add_block(page)
 item=snapshot(page)['objects'][0]['children'][0];assert item['shelfId']=='shelf-2'and item['z']==4
 page.locator('#rack-view-overview').click();expect(page.locator('#rack-overview')).to_be_visible();expect(top).to_have_attribute('aria-pressed','true')
 # Layout changes are reflected in the selector; arrow keys and Enter choose the new top floor.
 page.locator('#shelf-settings-button').click();page.locator('#add-shelf').click();page.locator('#frame-form button[type=submit]').click()
 expect(page.locator('[data-rack-shelf=shelf-3]')).to_be_visible();page.locator('#close-frame-editor').focus();page.keyboard.press('ArrowUp');expect(page.locator('[data-rack-shelf=shelf-3]')).to_be_focused();page.keyboard.press('Enter')
 expect(page.locator('#shelf-select')).to_have_value('shelf-3');add_block(page);assert snapshot(page)['objects'][0]['children'][-1]['z']==6
 page.locator('#rack-view-overview').click();page.locator('[data-rack-shelf=shelf-2]').hover();page.wait_for_timeout(360);page.screenshot(path='/workspace/shared/trail-rack-overview-expanded.png')
 page.mouse.move(5,5);page.wait_for_timeout(400);page.screenshot(path='/workspace/shared/trail-rack-overview-collapsed.png')
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 phone=browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True);phone.on('pageerror',lambda e:errors.append(str(e)));open_rack(phone)
 phone.locator('[data-rack-shelf=shelf-2]').tap();expect(phone.locator('#shelf-select')).to_have_value('shelf-2');add_block(phone)
 assert snapshot(phone)['objects'][0]['children'][0]['shelfId']=='shelf-2';phone.locator('#rack-view-overview').tap();phone.locator('[data-rack-shelf=shelf-1]').tap();expect(phone.locator('#shelf-select')).to_have_value('shelf-1')
 phone.locator('#rack-view-overview').tap();phone.screenshot(path='/workspace/shared/trail-rack-overview-phone.png');assert phone.evaluate('document.documentElement.scrollWidth<=innerWidth')
 reduced=browser.new_page(viewport={'width':1000,'height':800},reduced_motion='reduce');reduced.on('pageerror',lambda e:errors.append(str(e)));open_rack(reduced);reduced.locator('[data-rack-shelf=shelf-2]').hover();expect(reduced.locator('[data-rack-shelf=shelf-2]')).to_have_attribute('data-expansion','1.000')
 assert not errors,errors
 browser.close();print('PASS: stable hover expansion/collapse, immutable preview, click-to-edit chosen shelf, return, changed layout, keyboard, touch and reduced motion; no JS errors')
