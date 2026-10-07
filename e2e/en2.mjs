import { open } from './lib.mjs';
const { browser, page, errors } = await open({ lang: 'en-GB' });
await page.addInitScript(() => { localStorage.setItem('cfg:lang', 'en');  });
await page.goto('http://localhost:5199/');
await page.waitForSelector('#app:not([hidden])');
await page.clock.runFor(2000);
const scan = async tag => {
  const found = await page.evaluate(() => {
    const out = new Set();
    const spanish = /[áéíóúñ¿¡«»]|\b(el|la|los|las|de|del|para|con|que|una?|tu|tus|se|es|no|hoy|día|días|semana|actividad(es)?|hecho|añadir|guardar|eliminar|cerrar|elige|escribe|racha|sin|por|más|ya|al|en|lo|su|o|y)\b/i;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const el = n.parentElement;
      if (!el || el.closest('[translate="no"]') || ['SCRIPT', 'STYLE'].includes(el.tagName)) continue;
      const t = n.data.trim();
      if (t && spanish.test(t)) out.add('T: ' + t);
    }
    document.querySelectorAll('[placeholder],[aria-label],[title]').forEach(e => {
      if (e.closest('[translate="no"]')) return;
      ['placeholder', 'aria-label', 'title'].forEach(a => { const v = e.getAttribute(a); if (v && spanish.test(v)) out.add(`A(${a}): ` + v); });
    });
    return [...out];
  });
  console.log(`--- ${tag}: ${found.length}`); found.forEach(f => console.log(f));
};
await scan('inicio');
// preset

await page.waitForTimeout(100);
await page.clock.runFor(1000);
await scan('tutorial'); await page.screenshot({ path: '/tmp/work/en-tour.png' });
await page.click('#tourSkip');
await page.click('.preset[data-preset="focus"]'); await page.clock.runFor(1500); await scan('toast'); 
await page.clock.runFor(8000);
await page.click('#moreBtn'); await page.click('#menuRest'); await page.clock.runFor(100); await scan('descanso toast');
await page.clock.runFor(8000);
await page.click('#moreBtn'); await page.click('#menuTemplates'); await scan('plantillas');
await page.fill('#tplName', 'Mi día'); await page.click('#tplSave'); await page.clock.runFor(100); await scan('plantilla guardada'); await page.keyboard.press('Escape');
await page.click('#moreBtn'); await page.click('#menuRepeats'); await scan('repeticiones'); await page.keyboard.press('Escape');
await page.click('#openSettings'); await page.click('#openCats'); await scan('cats'); await page.screenshot({ path: '/tmp/work/en-cats.png' }); await page.keyboard.press('Escape');
await page.click('#openSettings'); await page.click('#deleteAccountBtn').catch(()=>{}); await scan('delete'); await page.keyboard.press('Escape');
await page.click('#openMenu'); await page.click('#menuPomo'); await scan('pomo'); await page.screenshot({ path: '/tmp/work/en-pomo.png' });
await page.click('#pomoToggle'); await page.clock.runFor(1500); await scan('pomo running'); await page.keyboard.press('Escape');
await page.click('#addBtn'); await page.fill('#fT','Test'); await page.fill('#fS','08:00'); await page.fill('#fE','08:30'); await page.click('#saveBtn'); await page.clock.runFor(200); await scan('guardado');
console.log('errors', errors);
await browser.close();
