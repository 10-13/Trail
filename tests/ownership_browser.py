"""User regression: deleting a rack removes all its pipes and returns material."""
import json
from playwright.sync_api import sync_playwright,expect
from browser_helpers import snapshot,click_world

def total(sim):
 return sum(sim['inventory'].values())+sum(sum(c[k].values())for c in sim['containers'].values()for k in ['input','output','stored'])+sum(len(t)for t in sim['pipes'].values())
def run(page):
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:4173');page.wait_for_selector('.catalog-card',state='attached');original=snapshot(page)
 page.keyboard.press('Tab');assert page.locator('[data-type]').count()==1;assert page.locator('[data-type=frame]').count()==1;assert page.locator('#world-pipe-palette,#pipe-height').count()==0;page.keyboard.press('Escape')
 click_world(page,10,3);page.locator('#edit-frame').click();page.locator('#rack-view-plan').click()
 assert page.locator('#shelf-canvas').evaluate("c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i]===236&&d[i+1]===98&&d[i+2]===98)n++;return n}")==0
 page.locator('#close-frame-editor').click();page.locator('#world-simulation [data-production-demo]').click();page.locator('#editor-simulation [data-sim-fast]').click();page.wait_for_timeout(350);page.locator('#editor-simulation [data-sim-toggle]').click()
 saved=snapshot(page);assert saved['pipes']==[] and saved['objects'][0]['pipes'];assert total(saved['simulation'])==128
 page.locator('#close-frame-editor').click();page.locator('#erase-tool').click();click_world(page,12,3)
 empty=snapshot(page);assert empty['objects']==[] and empty['pipes']==[];assert empty['simulation']['containers']=={} and empty['simulation']['pipes']=={};assert total(empty['simulation'])==128
 # Import the old unowned automatic route and delete it again through a pipe-covered rack cell.
 old=json.loads(json.dumps(saved));old['version']=5;f=old['objects'][0];old['pipes']=[{**p,'x':p['x']+f['x'],'y':p['y']+f['y'],'z':p['z']+f['z']}for p in f['pipes']];f['pipes']=[]
 page.keyboard.press('Tab');page.locator('#import-file').set_input_files({'name':'old-route.json','mimeType':'application/json','buffer':json.dumps(old).encode()});expect(page.locator('#toast')).to_contain_text('привязаны');page.keyboard.press('Escape')
 adopted=snapshot(page);assert adopted['pipes']==[] and adopted['objects'][0]['pipes'];assert total(adopted['simulation'])==128
 page.locator('#erase-tool').click();click_world(page,12,3);assert snapshot(page)['objects']==[];assert total(snapshot(page)['simulation'])==128
 # A legacy orphan is recovered on load, rather than kept floating in the wagon.
 orphan={'version':5,'wagon':saved['wagon'],'nextId':1,'nextPipeId':2,'player':{'x':3,'y':6,'angle':0},'objects':[],'pipes':[{'id':'pipe-1','x':12,'y':3,'z':0,'faces':['nx','px']}],'simulation':{'running':False,'rate':4,'tick':0,'inventory':{},'containers':{},'pipes':{'pipe-1':[{'resource':'crude','destination':'object-1/item-1/port-1'}]*3}}}
 page.keyboard.press('Tab');page.locator('#import-file').set_input_files({'name':'orphan.json','mimeType':'application/json','buffer':json.dumps(orphan).encode()});expect(page.locator('#toast')).to_contain_text('привязаны');page.keyboard.press('Escape');loaded=snapshot(page);assert loaded['pipes']==[] and loaded['simulation']['inventory']['crude']==3
 assert not errors,errors
with sync_playwright()as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 run(browser.new_page(viewport={'width':1440,'height':1000}));run(browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True));browser.close();print('PASS: desktop/mobile no floor marker, rack-only menu, filled rack deletion through pipe, stock recovery, legacy route adoption and orphan cleanup')
