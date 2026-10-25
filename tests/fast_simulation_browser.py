"""Fast simulation and live measured TPS through the native controls."""
import re
from playwright.sync_api import sync_playwright, expect
from browser_helpers import snapshot

def total(sim):
    n=sum(sim['inventory'].values())
    n+=sum(sum(c[key].values())for c in sim['containers'].values()for key in ['stored','input','output'])
    return n+sum(len(tokens)for tokens in sim['pipes'].values())

def run(page):
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto('http://127.0.0.1:4173');page.wait_for_selector('.catalog-card',state='attached')
    page.locator('#world-simulation [data-production-demo]').click()
    panel=page.locator('#editor-simulation')
    panel.locator('[data-sim-fast]').click()
    expect(panel.locator('[data-sim-fast]')).to_have_attribute('aria-pressed','true')
    expect(panel.locator('[data-sim-step]')).to_be_disabled()
    page.wait_for_timeout(1500)
    tps=int(re.sub(r'\D','',panel.locator('[data-sim-tps]').inner_text()))
    assert tps>0,tps
    # Input stays available during batches, including Tab construction palette.
    page.keyboard.press('Tab');expect(page.locator('#editor-menu')).to_be_visible();page.keyboard.press('Escape')
    panel.locator('[data-sim-toggle]').click()
    expect(panel.locator('[data-sim-tps]')).to_have_text('TPS 0')
    paused=snapshot(page);assert paused['simulation']['tick']>1000;assert paused['simulation']['rate']==10000
    assert total(paused['simulation'])==128
    page.wait_for_timeout(300);assert snapshot(page)['simulation']['tick']==paused['simulation']['tick']
    # Normal start returns to 4 TPS; one-step and pause continue to work.
    panel.locator('[data-sim-toggle]').click();page.wait_for_timeout(320);panel.locator('[data-sim-toggle]').click()
    ordinary=snapshot(page);assert ordinary['simulation']['rate']==4
    assert 1<=ordinary['simulation']['tick']-paused['simulation']['tick']<=3
    panel.locator('[data-sim-step]').click();assert snapshot(page)['simulation']['tick']==ordinary['simulation']['tick']+1
    page.locator('#close-frame-editor').click()
    panel=page.locator('#world-simulation');panel.locator('[data-sim-fast]').click();snapshot(page)
    page.reload();page.wait_for_selector('.catalog-card',state='attached')
    expect(panel.locator('[data-sim-fast]')).to_have_attribute('aria-pressed','true')
    page.wait_for_timeout(1200)
    tps2=int(re.sub(r'\D','',panel.locator('[data-sim-tps]').inner_text()));assert tps2>0
    panel.locator('[data-sim-fast]').click();expect(panel.locator('[data-sim-tps]')).to_have_text('TPS 0')
    assert total(snapshot(page)['simulation'])==128
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors,errors
    print(f"PASS {page.viewport_size}: measured editor {tps} TPS; wagon {tps2} TPS; responsive tools, pause, 4 TPS restart, step, reload and conservation")

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    run(browser.new_page(viewport={'width':1440,'height':1000}))
    run(browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True))
    browser.close()
